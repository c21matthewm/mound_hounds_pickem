import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
// Only fictional records in a new network-disabled local PostgreSQL container.
// No environment file, application service, remote database or image download.
const root=fileURLToPath(new URL('..',import.meta.url));
const read=name=>readFileSync(path.join(root,name),'utf8');
const schema=read('supabase/schema.sql'),original=read('supabase/migrations/20260730_atomic_picks_and_season_recovery.sql'),bounded=read('supabase/migrations/20260818_bound_recovery_jobs_and_registration.sql'),hardening=read('supabase/migrations/20260725_harden_race_and_season_operations.sql');
const extract=(text,kind,name)=>{const start=text.indexOf(kind==='table'?`create table if not exists public.${name} (`:`create or replace function public.${name}(`);const delimiter=kind==='table'?'\n);':'\n$$;';const end=text.indexOf(delimiter,start);assert.ok(start>=0&&end>start,name);return text.slice(start,end+delimiter.length);};
const A='00000000-0000-4000-8000-000000000001', B='00000000-0000-4000-8000-000000000002';
const bootstrap=[`create role anon;create role authenticated;create role service_role;create schema auth;create schema extensions;create extension pgcrypto with schema extensions;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;
 grant usage on schema public,auth to authenticated,anon,service_role;`,
 ...['profiles','drivers','league_seasons','season_participants','season_registration_secrets','app_metadata','races','results','picks','race_driver_groups','hall_of_fame_seasons','hall_of_fame_entries','admin_audit_events'].map(name=>extract(schema,'table',name)),
 extract(original,'table','pick_submission_versions'),extract(original,'table','season_restore_points'),
 `alter table public.season_restore_points add column retention_key text;alter table public.season_restore_points add column snapshot_bytes bigint not null default 0;
 alter table public.season_restore_points drop constraint season_restore_points_source_check;
 alter table public.season_restore_points add constraint season_restore_points_source_check check(source in('automatic','manual','pre_restore','uploaded','pre_rollover','result_checkpoint','pre_correction'));
 create unique index test_one_active on public.league_seasons(status) where status='active';`,
 extract(schema,'function','is_admin'),extract(schema,'function','protect_profile_role'),
 ...['write_admin_audit_event','admin_update_participant','require_invite_code_before_season_activation'].map(name=>extract(hardening,'function',name)),
 ...['season_recovery_row_counts','create_season_restore_point'].map(name=>extract(original,'function',name)),
 ...['build_season_recovery_snapshot','prune_season_restore_points','create_season_restore_point_v2'].map(name=>extract(bounded,'function',name)),
 `create trigger fixture_protect_role before insert or update of role,is_active on public.profiles for each row execute function public.protect_profile_role();
 create trigger fixture_activation_guard before insert or update of status on public.league_seasons for each row execute function public.require_invite_code_before_season_activation();
 grant select,insert,update,delete on all tables in schema public to authenticated;grant usage on all sequences in schema public to authenticated;
 insert into auth.users values('${A}'),('${B}');`
].join('\n');
const run=(cmd,args,input)=>{const r=spawnSync(cmd,args,{input,encoding:'utf8',timeout:25_000,maxBuffer:4*1024*1024});if(r.error||r.status!==0)throw new Error(r.error?.message??r.stderr.trim());return r.stdout.trim();};
const host=run('docker',['context','inspect','--format','{{(index .Endpoints "docker").Host}}']);assert.ok(host.startsWith('unix://'),'Only a local Docker socket is allowed.');
const container=`mound-lifecycle-${randomUUID()}`;const docker=(args,input)=>run('docker',['--host',host,...args],input);
const sqlArgs=['exec','-i',container,'psql','-X','-qAt','-h','127.0.0.1','-U','postgres','-v','ON_ERROR_STOP=1'];
const sql=text=>docker(sqlArgs,text);const actor=id=>`set role authenticated;set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='${id}';`;
const asUser=(text,id=A)=>sql(actor(id)+text);
const literal=text=>`'${String(text).replaceAll("'","''")}'`;
const context=()=>JSON.parse(asUser('select public.get_season_closeout_context(26);'));
const close=(hash=context().source_hash,entries=null,stamp='2026-09-01T00:00:00Z')=>`select public.complete_league_season(26,6,${literal(stamp)},${literal(hash)},${entries===null?'null':literal(JSON.stringify(entries))+'::jsonb'});`;
const status=()=>sql("select status from public.league_seasons where id=26;");
const backups=()=>Number(sql('select count(*) from public.season_restore_points;'));
let checks=0,started=false;
const check=(name,fn)=>{fn();checks++;console.log('PASS '+name);};
const reset=()=>sql(`truncate public.profiles,public.league_seasons,public.hall_of_fame_seasons,public.drivers,public.admin_audit_events restart identity cascade;
 alter table public.league_seasons disable trigger user;
 insert into public.profiles(id,full_name,team_name,role,is_active) values('${A}','Fixture Admin','Fixture Admin Team','admin',false),('${B}','Fixture Participant','Fixture Team','participant',true);
 insert into public.league_seasons(id,season_year,display_name,status,roster_configured_at,registration_code_configured_at) values(26,2026,'Fixture 2026','active',now(),now()),(27,2027,'Fixture 2027','upcoming',now(),now());
 insert into public.season_registration_secrets(season_id,invite_code_hash) values(26,'fixture-hash'),(27,'fixture-hash');
 alter table public.league_seasons enable trigger user;
 insert into public.hall_of_fame_seasons(id,season_year,champion_team_name,champion_total_points,participant_count,race_count,finalized_at) values(6,2026,'Fixture Champion',100,2,1,'2026-09-01T00:00:00Z');
 insert into public.hall_of_fame_entries(season_id,final_rank,team_name,total_points) values(6,1,'Fixture Champion',100),(6,2,'Fixture Runner',90);
 insert into public.drivers(id,driver_name,championship_points,current_standing,group_number) select n,'Fixture Driver '||n,7,n,n from generate_series(1,6)n;
 insert into public.season_participants(season_id,profile_id,status,registered_at) values(26,'${B}','registered',now()),(27,'${B}','registered',now());`);
const addRace=()=>sql("insert into public.races(id,season_id,round_number,race_name,race_date,qualifying_start_at,results_status,results_published_at,winner_auto_eligible_at) values(1,26,1,'Fixture race','2026-08-01','2026-07-31','published','2026-08-01',now());");
const entries=[{final_rank:1,team_name:'Fixture Champion',total_points:100,race_breakdown:[{race_id:1,race_name:'Fixture race',round_number:1,race_date:'2026-08-01',points:100}]},{final_rank:2,team_name:'Fixture Runner',total_points:90,race_breakdown:[{race_id:1,race_name:'Fixture race',round_number:1,race_date:'2026-08-01',points:90}]}];
const appArchive=()=>{addRace();for(const entry of entries)sql(`update public.hall_of_fame_entries set race_breakdown=${literal(JSON.stringify(entry.race_breakdown))}::jsonb where season_id=6 and final_rank=${entry.final_rank};`);};
try{
 docker(['run','-d','--rm','--pull=never','--network=none','--name',container,'-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:16-alpine']);started=true;
 let ready=false;for(let n=0;n<60;n++){try{docker(['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres']);ready=true;break;}catch{await new Promise(r=>setTimeout(r,200));}}assert.ok(ready);
 sql(bootstrap);const migration=read('supabase/migrations/20260921_season_completion.sql');sql(migration);sql(migration);
 reset();check('inactive administrator retains closeout permission',()=>assert.equal(context().historical_archive,true));
 check('participant cannot read closeout context',()=>assert.throws(()=>asUser('select public.get_season_closeout_context(26);',B),/Admin access/));
 check('anonymous cannot execute completion',()=>assert.throws(()=>sql("set role anon;select public.complete_league_season(26,6,now(),'x',null);"),/permission denied/));
 check('service role cannot execute completion',()=>assert.throws(()=>sql("set role service_role;select public.complete_league_season(26,6,now(),'x',null);"),/permission denied/));
 const oldArchive=sql('select jsonb_agg(to_jsonb(e) order by id) from public.hall_of_fame_entries e;');
 check('imported archive closes without fake races or profiles',()=>{asUser(close());assert.equal(status(),'completed');assert.equal(sql("select count(*) from public.league_seasons where status='active';"),'0');assert.equal(sql('select jsonb_agg(to_jsonb(e) order by id) from public.hall_of_fame_entries e;'),oldArchive);});
 check('completion preserves upcoming enrollment, account role and roster points',()=>{assert.equal(sql(`select status from public.season_participants where season_id=27 and profile_id='${B}';`),'registered');assert.equal(sql(`select role from public.profiles where id='${A}';`),'admin');assert.equal(sql('select sum(championship_points) from public.drivers;'),'42');});
 check('real recovery snapshot captures the pre-completion state',()=>{assert.equal(backups(),1);assert.equal(sql("select snapshot->'season'->>'status' from public.season_restore_points;"),'active');assert.equal(sql("select count(*) from public.admin_audit_events where action='complete_season';"),'1');});
 check('repeated completion is idempotent',()=>{assert.equal(JSON.parse(asUser(close())).already_completed,true);assert.equal(backups(),1);});
 check('off-season profile edits preserve both historical and upcoming enrollment',()=>{asUser(`select public.admin_update_participant_v2('${B}','Changed Fixture','Changed Team',true,false,false,null);`);assert.equal(sql(`select team_name from public.profiles where id='${B}';`),'Changed Team');assert.equal(sql(`select count(*) from public.season_participants where profile_id='${B}' and status='registered';`),'2');});
 check('off-season cannot invent registration or forced removal',()=>assert.throws(()=>asUser(`select public.admin_update_participant_v2('${B}','Name','Team',true,true,false,null);`),/no active season/));
 check('explicit activation opens the next season with backup and audit',()=>{asUser('select public.activate_league_season(27);');assert.equal(sql("select status from public.league_seasons where id=27;"),'active');assert.equal(sql('select sum(championship_points) from public.drivers;'),'0');assert.equal(backups(),2);assert.equal(sql("select count(*) from public.admin_audit_events where action='activate_season';"),'1');});
 check('stale off-season profile form cannot enroll in newly active season',()=>assert.throws(()=>asUser(`select public.admin_update_participant_v2('${B}','Wrong','Wrong Team',true,false,false,null);`),/active season changed/));
 check('completed season cannot be reactivated',()=>assert.throws(()=>asUser('select public.activate_league_season(26);'),/cannot be reactivated/));
 reset();check('activation requires explicit completion of current season',()=>{assert.throws(()=>asUser('select public.activate_league_season(27);'),/Complete the current season/);assert.equal(backups(),0);});
 check('stale archive confirmation fails',()=>{assert.throws(()=>asUser(close(undefined,null,'2026-08-01')),/archive changed/);assert.equal(status(),'active');});
 check('missing archive fails without closing',()=>{sql('delete from public.hall_of_fame_seasons where id=6;');assert.throws(()=>asUser(close()),/archive changed/);assert.equal(backups(),0);});
 reset();check('incomplete archive fails',()=>{sql("delete from public.hall_of_fame_entries where final_rank=2;");assert.throws(()=>asUser(close()),/archive is incomplete/);});
 reset();check('multiple champions fail',()=>{sql('update public.hall_of_fame_entries set final_rank=1 where final_rank=2;');assert.throws(()=>asUser(close()),/archive is incomplete/);});
 reset();check('source edits after review invalidate completion',()=>{const hash=context().source_hash;sql(`update public.profiles set team_name='Changed since review' where id='${B}';`);assert.throws(()=>asUser(close(hash)),/Season data changed/);assert.equal(backups(),0);});
 reset();check('historical archive cannot hide leftover app races',()=>{addRace();assert.throws(()=>asUser(close()),/historical archive has app race records/);});
 reset();appArchive();check('app closeout requires published results',()=>{sql("update public.races set results_status='draft';");assert.throws(()=>asUser(close(undefined,entries)),/Publish every scheduled race/);});
 reset();appArchive();check('app closeout refuses future race',()=>{sql("update public.races set race_date=now()+interval '1 day';");assert.throws(()=>asUser(close(undefined,entries)),/Publish every scheduled race/);});
 reset();appArchive();check('app archive race count must match the calendar',()=>{sql('update public.hall_of_fame_seasons set race_count=2;');assert.throws(()=>asUser(close(undefined,entries)),/archived race count differs/);});
 reset();appArchive();check('app archive must equal freshly calculated final standings',()=>{const changed=structuredClone(entries);changed[0].total_points++;assert.throws(()=>asUser(close(undefined,changed)),/Current standings differ/);assert.equal(backups(),0);});
 check('matching app archive completes and clears pending winner jobs',()=>{asUser(close(undefined,entries));assert.equal(status(),'completed');assert.equal(sql('select count(*) from public.races where winner_auto_eligible_at is not null;'),'0');});
 reset();check('failed audit rolls back completion and its recovery point',()=>{sql("create function public.fixture_reject_completion_audit() returns trigger language plpgsql as $$begin if new.action='complete_season' then raise exception 'Fixture audit failure';end if;return new;end$$;create trigger fixture_reject before insert on public.admin_audit_events for each row execute function public.fixture_reject_completion_audit();");assert.throws(()=>asUser(close()),/Fixture audit failure/);assert.equal(status(),'active');assert.equal(backups(),0);sql('drop trigger fixture_reject on public.admin_audit_events;');});
 check('capability diagnostics show missing functions without false readiness',()=>{const data=JSON.parse(asUser('select public.get_admin_capability_status();'));assert.equal(data.items.length,9);assert.equal(data.items.find(x=>x.name==='Season completion').installed,true);assert.equal(data.items.find(x=>x.name==='Rules documents').installed,false);});
 reset();check('active-season participant editing retains registration behavior',()=>{asUser(`select public.admin_update_participant_v2('${B}','Updated fixture','Updated fixture team',true,true,false,26);`);assert.equal(sql(`select status from public.season_participants where season_id=26 and profile_id='${B}';`),'registered');});
 check('active-season profile form rejects a different expected season',()=>assert.throws(()=>asUser(`select public.admin_update_participant_v2('${B}','Wrong','Wrong',true,false,false,27);`),/active season changed/));
 check('active-season picks still require explicit forced removal',()=>{addRace();sql(`insert into public.picks(user_id,race_id,average_speed,driver_group1_id,driver_group2_id,driver_group3_id,driver_group4_id,driver_group5_id,driver_group6_id) values('${B}',1,150,1,2,3,4,5,6);`);assert.throws(()=>asUser(`select public.admin_update_participant_v2('${B}','Fixture Participant','Fixture Team',true,false,false,26);`),/Use forced removal/);assert.equal(sql(`select status from public.season_participants where season_id=26 and profile_id='${B}';`),'registered');});
 reset();
 check('participant cannot inspect admin capability diagnostics',()=>assert.throws(()=>asUser('select public.get_admin_capability_status();',B),/Admin access/));
 // A writer holds the roster stable; closeout must fail promptly, not take a partial snapshot.
 const locker=spawn('docker',['--host',host,...sqlArgs],{stdio:['pipe','pipe','pipe']});let text='';
 const locked=new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('Lock session timeout')),10_000);locker.stdout.on('data',data=>{text+=data;if(text.includes('LOCK_HELD')){clearTimeout(t);resolve();}});});
 const closed=new Promise(resolve=>locker.on('close',resolve));locker.stderr.resume();
 try{locker.stdin.write('begin;lock public.drivers in row exclusive mode;\n\\echo LOCK_HELD\n');await locked;
 check('concurrent roster writes make completion retryable',()=>{assert.throws(()=>asUser(close()),/could not obtain lock/);assert.equal(status(),'active');});
 }finally{locker.stdin.end('rollback;\n\\q\n');await closed;}
 console.log(`PASS: ${checks} local season lifecycle checks; no live services used.`);
}finally{if(started)docker(['stop',container]);}

import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
// Fictional fixtures in a disposable, network-disabled local database only.
// Never reads application credentials, pulls images, or contacts existing databases.
const root=new URL('../',import.meta.url);
const read=p=>readFileSync(new URL(p,root),'utf8');
const schema=read('supabase/schema.sql');
const original=read('supabase/migrations/20260730_atomic_picks_and_season_recovery.sql');
const bounded=read('supabase/migrations/20260818_bound_recovery_jobs_and_registration.sql');
const portable=read('supabase/migrations/20260904_fix_portable_season_backups.sql');
const audit=read('supabase/migrations/20260725_harden_race_and_season_operations.sql');
const migration=read('supabase/migrations/20260930_recovery_retention.sql');
const extract=(source,kind,name)=>{const start=source.indexOf(kind==='table'?`create table if not exists public.${name} (`:`create or replace function public.${name}(`);const delimiter=kind==='table'?'\n);':'\n$$;';const end=source.indexOf(delimiter,start);assert.ok(start>=0&&end>start,name);return source.slice(start,end+delimiter.length);};
const A='00000000-0000-4000-8000-000000000001',P='00000000-0000-4000-8000-000000000002';
const bootstrap=[`create role anon;create role authenticated;create role service_role;create schema auth;create schema extensions;create extension pgcrypto with schema extensions;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;
 grant usage on schema public,auth to anon,authenticated,service_role;`,
 ...['profiles','drivers','league_seasons','season_participants','app_metadata','races','picks','results','race_driver_groups','admin_audit_events','hall_of_fame_seasons','hall_of_fame_entries'].map(n=>extract(schema,'table',n)),
 extract(original,'table','pick_submission_versions'),extract(original,'table','season_restore_points'),
 `alter table public.season_restore_points add column retention_key text;
 alter table public.season_restore_points add column snapshot_bytes bigint not null default 0;
 alter table public.season_restore_points drop constraint season_restore_points_source_check;
 alter table public.season_restore_points add constraint season_restore_points_source_check check(source in('automatic','manual','pre_restore','uploaded','pre_rollover','result_checkpoint','pre_correction'));`,
 extract(schema,'function','is_admin'),extract(audit,'function','write_admin_audit_event'),extract(schema,'function','refresh_driver_standings_from_published_results'),
 extract(bounded,'function','build_season_recovery_snapshot'),extract(original,'function','season_recovery_row_counts'),extract(original,'function','create_season_restore_point'),
 extract(original,'function','import_season_restore_point'),extract(original,'function','restore_season_from_restore_point'),extract(bounded,'function','restore_season_from_restore_point_v2'),
 extract(bounded,'function','prevent_season_restore_point_mutation'),extract(bounded,'function','set_season_restore_point_size'),
 `create trigger fixture_immutable before update or delete on public.season_restore_points for each row execute function public.prevent_season_restore_point_mutation();
 create trigger fixture_size before insert on public.season_restore_points for each row execute function public.set_season_restore_point_size();
 alter table public.season_restore_points enable row level security;
 grant select on public.season_restore_points to authenticated;
 create policy fixture_read_admin on public.season_restore_points for select to authenticated using(public.is_admin(auth.uid()));
 revoke all on function public.restore_season_from_restore_point_v2(uuid,integer) from public,anon,service_role;
 grant execute on function public.restore_season_from_restore_point_v2(uuid,integer) to authenticated;`,
 portable,read('tests/database/season-backup-fixtures.sql'),
 "insert into public.league_seasons(id,season_year,display_name,status) values(2,2025,'Completed fixture','completed');"
].join('\n');
const run=(command,args,input)=>{const result=spawnSync(command,args,{cwd:fileURLToPath(root),encoding:'utf8',input,maxBuffer:16*1024*1024,timeout:30_000});if(result.error||result.status!==0)throw new Error(result.error?.message??result.stderr.trim());return result.stdout.trim();};
const host=process.env.DOCKER_HOST||run('docker',['context','inspect','--format','{{(index .Endpoints "docker").Host}}']);
assert.ok(host.startsWith('unix://'),'Only local Docker Unix sockets are accepted.');
const image=process.env.RECOVERY_RETENTION_TEST_IMAGE||'postgres:16-alpine';
const container=`mound-retention-${randomUUID()}`;
const docker=(args,input)=>run('docker',['--host',host,...args],input);
const sqlArgs=['exec','--interactive',container,'psql','-X','-qAt','--host','127.0.0.1','--username','postgres','--dbname','postgres','--set','ON_ERROR_STOP=1'];
const literal=v=>`'${String(v).replaceAll("'","''")}'`;
const json=v=>`${literal(JSON.stringify(v))}::jsonb`;
const actor=(id=A,role='authenticated')=>`set request.jwt.claim.sub=${literal(id??'')};set request.jwt.claim.role=${literal(role)};`;
const sql=q=>docker(sqlArgs,actor()+q);
const asUser=(q,id=A,role='authenticated')=>sql(actor(id,role)+`set role ${role};`+q);
const j=q=>JSON.parse(asUser(`select ${q};`));
const ownerJson=q=>JSON.parse(sql(`select ${q};`));
const summary=(season=1)=>j(`public.get_season_restore_point_retention(${season})`);
const create=(source='manual',key=null,season=1)=>j(`public.create_season_restore_point_v2(${season},'Routine fixture',${literal(source)},${key===null?'null':literal(key)})`);
const exists=id=>sql(`select exists(select 1 from public.season_restore_points where id=${literal(id)}::uuid);`)==='t';
const clear=()=>sql('truncate public.season_restore_points,public.admin_audit_events;');
const seed=(count=7,season=1)=>{const points=[];for(let n=0;n<count;n++){const point=ownerJson(`public.create_season_restore_point(${season},'Old fixture ${n}','manual')`);sql(`begin;select set_config('mound_hounds.restore_point_maintenance','on',true);update public.season_restore_points set created_at=now()-interval '${count-n} days' where id=${literal(point.id)}::uuid;commit;`);points.push(point);}return points;};
const protect=(id,keep)=>j(`public.set_season_restore_point_protection(${literal(id)}::uuid,${keep})`);
const cleanup=(review=summary(),season=1)=>j(`public.cleanup_season_restore_points(${season},${literal(review.reviewToken)})`);
const exported=id=>j(`public.export_season_restore_point(${literal(id)}::uuid)`);
let checks=0,started=false;
const check=(name,fn)=>{fn();checks++;console.log('PASS '+name);};
const session=()=>{const child=spawn('docker',['--host',host,...sqlArgs],{stdio:['pipe','pipe','pipe']});let output='',error='';child.stdout.on('data',d=>{output+=d;});child.stderr.on('data',d=>{error+=d;});const closed=new Promise(resolve=>child.on('close',code=>resolve({code,output,error})));const marker=async text=>{for(let n=0;n<50;n++){if(output.includes(text))return;await new Promise(r=>setTimeout(r,100));}throw new Error('Session marker timeout '+text);};return {child,closed,marker};};
try{
 docker(['image','inspect',image,'--format','{{.Id}}']);
 docker(['run','--detach','--rm','--pull=never','--network=none','--name',container,'--env','POSTGRES_HOST_AUTH_METHOD=trust',image]);started=true;
 let ready=false;for(let n=0;n<60;n++){try{docker(['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres']);ready=true;break;}catch{await new Promise(r=>setTimeout(r,200));}}assert.ok(ready);
 sql(bootstrap);const old=seed();sql(migration);sql(migration);
 check('install is idempotent and does not remove existing history',()=>{assert.equal(summary().routineCount,7);assert.equal(summary().cleanupCount,4);assert.equal(sql("select value from public.app_metadata where key='recovery_retention_version';"),'20260930');});
 check('summary includes full byte counts without snapshot payloads or ID arrays',()=>{const s=summary();assert.equal(s.totalBytes,Number(sql('select sum(snapshot_bytes) from public.season_restore_points;')));assert.match(s.reviewToken,/^[a-f0-9]{64}$/);assert.equal('candidateIds' in s,false);assert.equal('snapshot' in s,false);});
 for(const signature of ['public.get_season_restore_point_retention(bigint)','public.cleanup_season_restore_points(bigint,text)','public.set_season_restore_point_protection(uuid,boolean)']){
  check('admin-only grant '+signature,()=>{for(const role of ['anon','service_role'])assert.equal(sql(`select has_function_privilege(${literal(role)},${literal(signature)},'execute');`),'f');assert.equal(sql(`select has_function_privilege('authenticated',${literal(signature)},'execute');`),'t');});
 }
 check('participant cannot inspect or clean recovery history',()=>{assert.throws(()=>asUser('select public.get_season_restore_point_retention(1);',P),/Admin access/);assert.throws(()=>asUser("select public.cleanup_season_restore_points(1,'x');",P),/Admin access/);assert.throws(()=>asUser(`select public.set_season_restore_point_protection(${literal(old[0].id)}::uuid,true);`,P),/Admin access/);});
 check('public callers cannot bypass retention through legacy creation',()=>{assert.throws(()=>asUser("select public.create_season_restore_point(1,'Bypass','manual');"),/permission denied/);assert.throws(()=>asUser("select public.create_season_restore_point(1,'Bypass','manual');",null,'service_role'),/permission denied/);});
 const before=exported(old[0].id),review=summary();
 check('permanent protection changes metadata only',()=>{const p=protect(old[0].id,true);assert.equal(p.protected,true);assert.equal(p.retentionKey,'manual:protected');assert.deepEqual(exported(old[0].id),before);assert.equal(p.retention.routineCount,6);assert.equal(p.retention.cleanupCount,3);});
 check('protection changes invalidate reviewed cleanup',()=>assert.throws(()=>cleanup(review),/changed since review/));
 check('unprotect does not immediately delete old copy',()=>{const p=protect(old[0].id,false);assert.equal(exists(old[0].id),true);assert.equal(p.retention.cleanupCount,4);});
 check('cleanup removes exactly reviewed older copies and reports own writes',()=>{const s=summary(),c=cleanup(s);assert.equal(c.deletedCount,4);assert.equal(c.deletedBytes,s.cleanupBytes);assert.equal(c.retention.routineCount,3);assert.equal(c.retention.cleanupCount,0);for(const p of old.slice(4))assert.ok(exists(p.id));});
 check('repeated current cleanup does not add redundant audit rows',()=>{const n=sql('select count(*) from public.admin_audit_events;');assert.equal(cleanup().deletedCount,0);assert.equal(sql('select count(*) from public.admin_audit_events;'),n);});
 clear();seed(5,2);
 check('completed seasons support explicit routine cleanup',()=>{const s=summary(2);assert.equal(s.seasonYear,2025);assert.equal(cleanup(s,2).deletedCount,2);assert.equal(summary(2).routineCount,3);assert.equal(sql('select count(*) from public.season_restore_points where season_id=1;'),'0');});
 clear();const originals=seed();
 const protectedPoint=create('manual','legacy:keep');
 const milestone=create('pre_rollover','season:1:completion'),safety=create('pre_restore'),upload=create('uploaded');
 check('non-routine creation keeps safety and permanently protected copies',()=>{for(const p of [protectedPoint,milestone,safety,upload])assert.ok(exists(p.id));assert.equal(summary().routineCount,3);assert.equal(summary().protectedCount,4);});
 check('next routine creation retains its new point and the limit',()=>{const p=create();assert.ok(exists(p.id));assert.equal(summary().routineCount,3);for(const keep of [protectedPoint,milestone,safety,upload])assert.ok(exists(keep.id));assert.equal(exists(originals[0].id),false);});
 check('unknown non-null protection keys survive repeat protection',()=>{assert.equal(protect(protectedPoint.id,true).retentionKey,'legacy:keep');});
 check('only manual points can change protection',()=>assert.throws(()=>protect(safety.id,false),/Only manual backups/));
 check('immutable payloads still reject ordinary updates',()=>assert.throws(()=>sql(`update public.season_restore_points set label='Mutated' where id=${literal(safety.id)}::uuid;`),/immutable/));
 check('null and invalid sources/keys are rejected',()=>{assert.throws(()=>asUser("select public.create_season_restore_point_v2(1,'Invalid',null,null);"),/Invalid restore-point source/);assert.throws(()=>create('manual','  '),/Invalid restore-point retention key/);});
 check('missing season and null cleanup review are rejected',()=>{assert.throws(()=>summary(999),/Selected season was not found/);assert.throws(()=>asUser('select public.cleanup_season_restore_points(1,null);'),/changed since review/);});
 check('correction snapshots remain limited to five',()=>{for(let n=0;n<8;n++)create('pre_correction',`round:${n}`);assert.equal(sql("select count(*) from public.season_restore_points where source in('automatic','pre_correction');"),'5');});
 check('checkpoints remain one per key, independently across keys',()=>{for(let n=0;n<4;n++)create('result_checkpoint','round:1');create('result_checkpoint','round:2');assert.equal(sql("select count(*) from public.season_restore_points where source='result_checkpoint';"),'2');});
 check('service role can still create and rotate checkpoints',()=>{const result=JSON.parse(asUser("select public.create_season_restore_point_v2(1,'Service fixture','result_checkpoint','round:1');",null,'service_role'));assert.ok(exists(result.id));assert.equal(sql("select count(*) from public.season_restore_points where source='result_checkpoint' and retention_key='round:1';"),'1');});
 check('just-created point survives UUID ordering when timestamps tie',()=>{
  const answer=sql(`begin;truncate public.season_restore_points;
   alter table public.season_restore_points alter column id set default '00000000-0000-4000-8000-000000000010'::uuid;
   insert into public.season_restore_points(id,season_id,season_year,label,source,schema_version,row_counts,snapshot,checksum,created_at)
   select ('ffffffff-ffff-4fff-8fff-'||lpad(n::text,12,'0'))::uuid,1,2026,'Tie fixture','manual','fixture','{}'::jsonb,'{}'::jsonb,repeat('0',64),now() from generate_series(1,3)n;
   select public.create_season_restore_point_v2(1,'Newest tie','manual',null);
   select exists(select 1 from public.season_restore_points where id='00000000-0000-4000-8000-000000000010');rollback;`);
  assert.equal(answer.split('\n').at(-1),'t');
 });
 clear();const roundtrip=create();const doc=exported(roundtrip.id);const digest=t=>createHash('sha256').update(t,'utf8').digest('hex');
 check('portable export preserves exact decimals and checksum after retention migration',()=>{assert.equal(doc.checksum,digest(doc.snapshotText));assert.match(doc.snapshotText,/"payout": 0\.00/);assert.match(doc.snapshotText,/"average_speed": 190\.000/);});
 const imported=j(`public.import_season_restore_point_v2(${json(JSON.parse(JSON.stringify(doc)))})`);
 check('portable imports remain protected and keep exact canonical snapshot bytes',()=>{assert.equal(imported.source,'uploaded');assert.equal(exported(imported.id).snapshotText,doc.snapshotText);assert.equal(summary().protectedCount,1);});
 check('protection does not alter exported checksum or snapshot',()=>{protect(roundtrip.id,true);assert.deepEqual(exported(roundtrip.id),doc);protect(roundtrip.id,false);});
 check('restore still creates its protected legacy-internal safety snapshot',()=>{
  sql('update public.races set payout=75.25 where id=1;');
  const restored=j(`public.restore_season_from_restore_point_v2(${literal(imported.id)}::uuid,2026)`);
  assert.equal(restored.restoredPointId,imported.id);assert.equal(sql('select payout::text from public.races where id=1;'),'0.00');assert.equal(sql(`select source from public.season_restore_points where id=${literal(restored.safetyPointId)}::uuid;`),'pre_restore');
 });
 clear();const rollbackPoints=seed();
 check('failed audit rolls back cleanup and preserves history',()=>{
  sql("create function public.fixture_reject_audit() returns trigger language plpgsql as $$begin if new.action='cleanup_season_restore_points' then raise exception 'Fixture audit failure';end if;return new;end$$;create trigger fixture_reject_audit before insert on public.admin_audit_events for each row execute function public.fixture_reject_audit();");
  assert.throws(()=>cleanup(),/Fixture audit failure/);assert.equal(summary().routineCount,7);for(const p of rollbackPoints)assert.ok(exists(p.id));
  sql('drop trigger fixture_reject_audit on public.admin_audit_events;');
 });
 check('maintenance flag is not left enabled after a caught failure',()=>{
  assert.equal(sql(`begin;do $$begin begin perform public.cleanup_season_restore_points(1,'stale');exception when others then null;end;end$$;select coalesce(current_setting('mound_hounds.restore_point_maintenance',true),'off')='on';rollback;`),'f');
 });
 const locker=session();try{
  locker.child.stdin.write(`begin;select pg_advisory_xact_lock(hashtextextended('mound_hounds:recovery:1',0));\n\\echo MAINTENANCE_LOCKED\n`);await locker.marker('MAINTENANCE_LOCKED');
  check('create, cleanup and protection fail promptly during concurrent maintenance',()=>{const review=summary();for(const q of ["select public.create_season_restore_point_v2(1,'Busy','manual',null);",`select public.cleanup_season_restore_points(1,${literal(review.reviewToken)});`,`select public.set_season_restore_point_protection(${literal(rollbackPoints[0].id)}::uuid,true);`]){const startedAt=Date.now();assert.throws(()=>asUser(q),/busy/);assert.ok(Date.now()-startedAt<3000);}assert.equal(summary().routineCount,7);});
 }finally{locker.child.stdin.end('rollback;\n\\q\n');assert.equal((await locker.closed).code,0);}
 clear();const lockedPoints=seed(5);const lockedReview=summary();const restoreLocker=session();let cleanupSession;
 try{
  restoreLocker.child.stdin.write(actor()+`begin;select id from public.season_restore_points where id=${literal(lockedPoints[0].id)}::uuid for update;select id from public.league_seasons where id=1 for update;\n\\echo RESTORE_LOCKED\n`);await restoreLocker.marker('RESTORE_LOCKED');
  cleanupSession=session();cleanupSession.child.stdin.end(actor()+`set role authenticated;set application_name='retention-cleanup';select public.cleanup_season_restore_points(1,${literal(lockedReview.reviewToken)});\n`);
  let waiting=false;for(let n=0;n<15;n++){if(sql("select exists(select 1 from pg_stat_activity where application_name='retention-cleanup' and wait_event_type='Lock');")==='t'){waiting=true;break;}await new Promise(r=>setTimeout(r,100));}assert.ok(waiting,'Cleanup must overlap the restore point lock.');
  restoreLocker.child.stdin.end(`select public.restore_season_from_restore_point_v2(${literal(lockedPoints[0].id)}::uuid,2026);commit;\n\\q\n`);
  const restored=await restoreLocker.closed,cleaned=await cleanupSession.closed;
  check('cleanup overlapping actual restoration does not deadlock or lose safety snapshot',()=>{assert.equal(restored.code,0,restored.error);assert.equal(cleaned.code,0,cleaned.error);const result=JSON.parse(cleaned.output);assert.equal(result.deletedCount,2);assert.equal(sql("select count(*) from public.season_restore_points where source='pre_restore';"),'1');assert.equal(summary().routineCount,3);});
 }finally{if(!restoreLocker.child.stdin.destroyed)restoreLocker.child.stdin.end('rollback;\n\\q\n');await restoreLocker.closed;if(cleanupSession)await cleanupSession.closed;}
 sql(read('supabase/migrations/20260930_idempotent_pick_saves.sql'));
 const capabilities=read('supabase/migrations/20260930_storage_and_pick_capabilities.sql');sql(capabilities);sql(capabilities);
 const installed=name=>j('public.get_admin_capability_status()').items.find(item=>item.name===name).installed;
 check('capability diagnostics recognize both installed implementations',()=>{assert.equal(installed('Routine backup retention'),true);assert.equal(installed('Unchanged pick saves'),true);assert.equal(sql("select value from public.app_metadata where key='schema_version';"),'20260904_portable_season_backups_v2');});
 check('capabilities reject missing version markers instead of claiming readiness',()=>{sql("delete from public.app_metadata where key in('recovery_retention_version','pick_save_idempotency_version');");assert.equal(installed('Routine backup retention'),false);assert.equal(installed('Unchanged pick saves'),false);sql(migration);sql(read('supabase/migrations/20260930_idempotent_pick_saves.sql'));});
 check('retention capability requires all authenticated RPC grants',()=>{sql('revoke execute on function public.cleanup_season_restore_points(bigint,text) from authenticated;');assert.equal(installed('Routine backup retention'),false);sql('grant execute on function public.cleanup_season_restore_points(bigint,text) to authenticated;');assert.equal(installed('Routine backup retention'),true);});
 console.log(`PASS: ${checks} isolated recovery retention checks; no live services used.`);
}catch(error){if(!started)console.error(`Requires a local Docker socket and cached ${image}; no images are pulled.`);throw error;}
finally{if(started)docker(['stop',container]);}

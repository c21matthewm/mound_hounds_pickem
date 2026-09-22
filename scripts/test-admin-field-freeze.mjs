import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=process.argv[2]||fileURLToPath(new URL('..',import.meta.url));
const migration=process.argv[3]||path.join(root,'supabase/migrations/20260913_admin_freeze_race_field.sql');
const read=p=>readFileSync(root+'/'+p,'utf8');
const schema=read('supabase/schema.sql');
const extract=(s,kind,name)=>{const start=s.indexOf(kind==='table'?`create table if not exists public.${name} (`:`create or replace function public.${name}(`);const end=s.indexOf(kind==='table'?'\n);':'\n$$;',start);assert(start>=0&&end>start);return s.slice(start,end+(kind==='table'?3:4));};
// Do not pull images or connect to a remote Docker daemon/database.
const context=spawnSync('docker',['context','inspect','--format','{{(index .Endpoints "docker").Host}}'],{encoding:'utf8',timeout:10000});
assert.equal(context.status,0,context.stderr);
const host=context.stdout.trim();assert.ok(host.startsWith('unix://'),'Only a local Docker socket is allowed.');
const name='mound-field-freeze-'+randomUUID();
const run=(args,input,allow=false)=>{const r=spawnSync('docker',['--host',host,...args],{input,encoding:'utf8',timeout:30000});if(!allow&&r.status!==0)throw new Error(r.stderr);return r;};
const sql=(text,allow=false)=>run(['exec','-i',name,'psql','-X','-qAt','-h','127.0.0.1','-U','postgres','-v','ON_ERROR_STOP=1'],text,allow);
const actor="set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001'; set request.jwt.claim.role='authenticated'; ";
let started=false;let checks=0;
try {
run(['run','-d','--rm','--pull=never','--network=none','--name',name,'-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:16-alpine']);started=true;
for(let n=0;n<60;n++){if(run(['exec',name,'pg_isready','-h','127.0.0.1','-U','postgres'],undefined,true).status===0)break;await new Promise(r=>setTimeout(r,250));}
const bootstrap=[`create role anon;create role authenticated;create role service_role;create schema auth;create schema extensions;create extension pgcrypto with schema extensions;
 create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;`,
 ...['profiles','drivers','league_seasons','races','race_driver_groups','admin_audit_events'].map(t=>extract(schema,'table',t)),
 extract(schema,'function','is_admin'),
 extract(read('supabase/migrations/20260725_harden_race_and_season_operations.sql'),'function','write_admin_audit_event'),
 extract(read('supabase/migrations/20260726_add_shared_pick_windows.sql'),'function','ensure_race_pick_field_snapshot'),
 extract(read('supabase/migrations/20260831_harden_season_rollover_registration.sql'),'function','pick_window_opens_at'),
 readFileSync(migration,'utf8'),
 `insert into auth.users values ('00000000-0000-4000-8000-000000000001');insert into public.profiles(id,team_name,full_name,role,is_active) values ('00000000-0000-4000-8000-000000000001','Fixture admin','Organizer','admin',false);
 insert into public.league_seasons(id,season_year,display_name,status) values(1,2027,'Fixture season','active');
 insert into public.drivers(driver_name,current_standing,group_number) select 'Driver '||n,n,n from generate_series(1,6) n;
 insert into public.races(id,race_name,season_id,round_number,qualifying_start_at,race_date,pick_window_key) values
 (1,'Fixture doubleheader 1',1,1,now()+interval '3 days',now()+interval '4 days','00000000-0000-4000-8000-000000000010'),
 (2,'Fixture doubleheader 2',1,2,now()+interval '3 days',now()+interval '5 days','00000000-0000-4000-8000-000000000010'),
 (3,'Fixture next race',1,3,now()+interval '8 days',now()+interval '9 days','00000000-0000-4000-8000-000000000011');`
].join('\n');sql(bootstrap);
const assertFailure=(prefix,id,pattern)=>{const result=sql('begin;'+actor+prefix+`select public.admin_freeze_race_field(${id}); rollback;`,true);assert.notEqual(result.status,0,result.stdout);assert.match(result.stderr,pattern);checks++;};
assertFailure("set request.jwt.claim.role='anon';",1,/Only an admin/);
assertFailure("update public.profiles set role='participant';",1,/Only an admin/);
assertFailure("update public.league_seasons set status='upcoming';",1,/active season/);
assertFailure("update public.races set is_archived=true where id=1;",1,/non-archived/);
assertFailure("update public.races set qualifying_start_at=now()+interval '9 days',race_date=now()+interval '10 days' where id in(1,2);",1,/six days/);
assertFailure("update public.races set qualifying_start_at=now()-interval '1 second' where id=1;",2,/closed/);
assertFailure('',3,/previous pick window/);
assertFailure("update public.drivers set is_active=false where group_number=6;",1,/Every standard pick group/);
assertFailure("update public.races set pick_format='indy_500' where id in(1,2);",1,/33-driver qualifying/);
// A late audit failure must undo both field timestamps and both snapshots.
assertFailure("create function public.fixture_audit_fail() returns trigger language plpgsql as $$begin raise exception 'Intentional audit failure';end;$$; create trigger fixture_fail before insert on public.admin_audit_events for each row execute function public.fixture_audit_fail();",1,/Intentional audit failure/);
assert.equal(sql('select count(*) from public.race_driver_groups;').stdout.trim(),'0');assert.equal(sql('select count(*) from public.races where field_frozen_at is not null;').stdout.trim(),'0');checks++;
let result=JSON.parse(sql(actor+'select public.admin_freeze_race_field(2);').stdout);assert.equal(result.driver_count,6);assert.equal(result.already_frozen,false);assert.equal(sql('select count(*) from public.races where field_frozen_at is not null;').stdout.trim(),'2');assert.equal(sql('select count(*) from public.race_driver_groups;').stdout.trim(),'12');checks++;
result=JSON.parse(sql(actor+'select public.admin_freeze_race_field(1);').stdout);assert.equal(result.already_frozen,true);assert.equal(sql('select count(*) from public.admin_audit_events;').stdout.trim(),'1');checks++;
sql("update public.races set results_status='published' where id in(1,2);");result=JSON.parse(sql(actor+'select public.admin_freeze_race_field(3);').stdout);assert.equal(result.driver_count,6);checks++;
console.log(`PASS: ${checks} offline field-freeze checks, including both doubleheader fields and audit rollback.`);
} finally {if(started)run(['stop','--time','1',name]);}

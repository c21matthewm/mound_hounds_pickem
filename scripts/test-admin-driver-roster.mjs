import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=process.argv[2]||fileURLToPath(new URL('..',import.meta.url));
const migration=process.argv[3]||path.join(root,'supabase/migrations/20260919_bulk_driver_roster.sql');
const read=p=>readFileSync(root+'/'+p,'utf8');
const schema=read('supabase/schema.sql');
const extract=(s,kind,name)=>{const start=s.indexOf(kind==='table'?`create table if not exists public.${name} (`:`create or replace function public.${name}(`);const end=s.indexOf(kind==='table'?'\n);':'\n$$;',start);assert(start>=0&&end>start);return s.slice(start,end+(kind==='table'?3:4));};
// Do not pull images or connect to a remote Docker daemon/database.
const context=spawnSync('docker',['context','inspect','--format','{{(index .Endpoints "docker").Host}}'],{encoding:'utf8',timeout:10000});
assert.equal(context.status,0,context.stderr);
const host=context.stdout.trim();assert.ok(host.startsWith('unix://'),'Only a local Docker socket is allowed.');
const name='mound-driver-bulk-'+randomUUID();
const run=(args,input,allow=false)=>{const r=spawnSync('docker',['--host',host,...args],{input,encoding:'utf8',timeout:30000});if(!allow&&r.status!==0)throw new Error(r.stderr);return r;};
const sql=(text,allow=false)=>run(['exec','-i',name,'psql','-X','-qAt','-h','127.0.0.1','-U','postgres','-v','ON_ERROR_STOP=1'],text,allow);
const actor="set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001'; set request.jwt.claim.role='authenticated'; ";
let started=false;let checks=0;let lockSession;
try {
run(['run','-d','--rm','--pull=never','--network=none','--name',name,'-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:16-alpine']);started=true;
for(let n=0;n<60;n++){if(run(['exec',name,'pg_isready','-h','127.0.0.1','-U','postgres'],undefined,true).status===0)break;await new Promise(r=>setTimeout(r,250));}
const bootstrap=[`create role anon;create role authenticated;create role service_role;create schema auth;create schema extensions;create extension pgcrypto with schema extensions;
 create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;`,
 ...['profiles','drivers','league_seasons','races','race_driver_groups','admin_audit_events'].map(t=>extract(schema,'table',t)),
 extract(schema,'function','is_admin'),
 extract(read('supabase/migrations/20260725_harden_race_and_season_operations.sql'),'function','write_admin_audit_event'),
 readFileSync(migration,'utf8'),
 `insert into auth.users values ('00000000-0000-4000-8000-000000000001');insert into public.profiles(id,team_name,full_name,role,is_active) values ('00000000-0000-4000-8000-000000000001','Fixture admin','Organizer','admin',false);
 insert into public.league_seasons(id,season_year,display_name,status) values(1,2027,'Fixture season','active');
 insert into public.drivers(id,driver_name,current_standing,group_number,championship_points,opening_seed_standing,is_active)
 select n,'Driver '||n,n,least(6,((n-1)/4)+1),100-n,n,n<=25 from generate_series(1,26) n;
 insert into public.races(id,race_name,season_id,round_number,qualifying_start_at,race_date,pick_window_key,field_frozen_at) values
 (1,'Frozen fixture',1,1,now()+interval '3 days',now()+interval '4 days','00000000-0000-4000-8000-000000000010',now());
 insert into public.race_driver_groups(race_id,driver_id,group_number) values (1,1,1);`

].join('\n');sql(bootstrap);
const selection='[{"id":1,"expected_is_active":true},{"id":26,"expected_is_active":false}]';
const call=(data=selection,active=false)=>`select public.admin_set_driver_roster_status('${data}',${active});`;
const fail=(prefix,body,pattern)=>{const result=sql('begin;'+actor+prefix+body+'rollback;',true);assert.notEqual(result.status,0,result.stdout);assert.match(result.stderr,pattern);checks++;};
fail("set request.jwt.claim.role='anon';",call(),/Only an admin/);
fail("update profiles set role='participant';",call(),/Only an admin/);
for(const value of ['[]','null','{}'])fail('',call(value),/Choose/);
fail('',call('[{"id":1,"expected_is_active":true},{"id":1,"expected_is_active":true}]'),/only once/);
fail('',call('[{"id":99,"expected_is_active":true}]'),/no longer exists/);
fail('',call('[{"id":1,"expected_is_active":false}]'),/status changed/);
fail('',call('[{"id":1,"expected_is_active":"true"}]'),/valid id/);
fail('',call(JSON.stringify(Array.from({length:101},(_,n)=>({id:n+1,expected_is_active:true})))),/between 1 and 100/);
fail("create function fixture_audit_fail() returns trigger language plpgsql as $$begin raise exception 'Intentional audit failure';end;$$;create trigger fixture_fail before insert on admin_audit_events for each row execute function fixture_audit_fail();",call(),/Intentional audit failure/);
assert.equal(sql('select is_active from drivers where id=1;').stdout.trim(),'t');assert.equal(sql('select current_standing from drivers where id=2;').stdout.trim(),'2');checks++;
const changed=JSON.parse(sql(actor+call()).stdout);assert.equal(changed.changed_count,1);assert.equal(sql('select current_standing from drivers where id=2;').stdout.trim(),'1');assert.equal(sql('select count(*) from drivers;').stdout.trim(),'26');assert.equal(sql('select group_number from race_driver_groups where race_id=1 and driver_id=1;').stdout.trim(),'1');assert.equal(sql('select championship_points from drivers where id=1;').stdout.trim(),'99');assert.equal(sql('select opening_seed_standing from drivers where id=1;').stdout.trim(),'1');checks++;
const noop=JSON.parse(sql(actor+call('[{"id":1,"expected_is_active":false}]')).stdout);assert.equal(noop.changed_count,0);assert.equal(sql('select count(*) from admin_audit_events;').stdout.trim(),'1');checks++;
const enabled=JSON.parse(sql(actor+call('[{"id":1,"expected_is_active":false},{"id":26,"expected_is_active":false}]',true)).stdout);assert.equal(enabled.changed_count,2);assert.equal(sql('select current_standing from drivers where id=1;').stdout.trim(),'1');assert.equal(sql('select count(*) from drivers where is_active;').stdout.trim(),'26');checks++;
// Roster changes must not turn a seeded contender into a bottom-group driver
// when no race has scored yet, or when championship points are tied later on.
for (const points of [0,100]) {
 sql(`update drivers set championship_points=${points};`);
 sql(actor+call('[{"id":1,"expected_is_active":true}]',false));
 assert.equal(sql('select group_number from race_driver_groups where race_id=1 and driver_id=1;').stdout.trim(),'1');
 sql(actor+call('[{"id":1,"expected_is_active":false}]',true));
 assert.equal(sql('select current_standing from drivers where id=1;').stdout.trim(),'1',`Seed #1 must regain first place when points are tied at ${points}.`);
 assert.equal(sql('select group_number from drivers where id=1;').stdout.trim(),'1');
 assert.equal(sql('select opening_seed_standing from drivers where id=1;').stdout.trim(),'1');
 assert.equal(sql('select championship_points from drivers where id=1;').stdout.trim(),String(points));
 checks++;
}
const stale=sql('begin isolation level repeatable read;'+actor+call()+'rollback;',true);assert.notEqual(stale.status,0);assert.match(stale.stderr,/Read Committed/);checks++;
assert.equal(sql("select has_function_privilege('anon','public.admin_set_driver_roster_status(jsonb,boolean)','execute');").stdout.trim(),'f');checks++;
lockSession=spawn('docker',['--host',host,'exec','-i',name,'psql','-X','-qAt','-h','127.0.0.1','-U','postgres','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});
const closed=new Promise(resolve=>lockSession.on('close',resolve));
const ready=new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(new Error('Lock fixture did not start.')),5000);lockSession.stdout.on('data',chunk=>{text+=chunk;if(text.includes('ROSTER_LOCKED')){clearTimeout(timer);resolve();}});lockSession.on('error',reject);});
lockSession.stdin.write("begin; lock public.drivers in row share mode; select 'ROSTER_LOCKED';\n");
await ready;fail('',call(),/could not obtain lock/);lockSession.stdin.end('rollback;\n');await closed;lockSession=null;
console.log(`PASS: ${checks} offline bulk roster checks, including preserved frozen fields and audit rollback.`);
} finally {if(lockSession)lockSession.kill();if(started)run(['stop','--time','1',name]);}

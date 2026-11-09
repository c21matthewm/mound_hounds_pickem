import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// Only a fresh local, network-disabled PostgreSQL container and a cached image.
// Never read dotenv files, application credentials, or connect to an existing DB.
const root = fileURLToPath(new URL("../", import.meta.url));
const read = name => readFileSync(new URL(name, new URL("../", import.meta.url)), "utf8");
const schema = read("supabase/schema.sql");
const extract = (kind, name) => {
  const start = schema.indexOf(kind === "table" ? `create table if not exists public.${name} (` : `create or replace function public.${name}(`);
  const end = schema.indexOf(kind === "table" ? "\n);" : "\n$$;", start);
  assert.ok(start >= 0 && end > start, `Missing ${kind}: ${name}`);
  return schema.slice(start, end + (kind === "table" ? 3 : 4));
};
const run = (args, input, allowedFailure = false) => {
  const result = spawnSync("docker", args, { cwd: root, encoding: "utf8", input, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
  if (!allowedFailure && result.status !== 0) throw new Error(result.error?.message ?? result.stderr);
  return result;
};
const host = run(["context", "inspect", "--format", '{{(index .Endpoints "docker").Host}}']).stdout.trim();
assert.ok(host.startsWith("unix://"), "Only a local Docker Unix socket is permitted.");
const name = `mound-results-automation-${randomUUID()}`;
const image = "postgres:16-alpine";
const docker = (args, input, allowedFailure) => run(["--host", host, ...args], input, allowedFailure);
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${literal(JSON.stringify(value))}::jsonb`;
const hash = value => createHash("sha256").update(value).digest("hex");
const admin = "00000000-0000-4000-8000-000000000001";
const participant = "00000000-0000-4000-8000-000000000002";
const prefix = (role = "service_role", actor = "") => `set role ${role}; set request.jwt.claim.role=${literal(role)}; set request.jwt.claim.sub=${literal(actor)};`;
const sqlArgs = ["exec", "-i", name, "psql", "-X", "-qAt", "-h", "127.0.0.1", "-U", "postgres", "-v", "ON_ERROR_STOP=1"];
const sql = statement => docker(sqlArgs, statement).stdout.trim();
const value = (statement, role = "service_role", actor = "") => JSON.parse(sql(prefix(role, actor) + `select to_json(${statement});`));
let checks = 0;
const check = (message, callback) => { callback(); checks++; console.log("PASS: " + message); };
const fails = (statement, pattern, role = "service_role", actor = "") => {
  if(statement.includes("public.publish_staged_race_results")&&role==="service_role"){role="authenticated";actor=admin;}
  statement=statement.replace(/'fixture-[a-z-]+'/g,label=>literal(messageId(label.slice(1,-1))));
  const result = docker(sqlArgs, prefix(role, actor) + statement, true);
  assert.notEqual(result.status, 0); assert.match(result.stderr, pattern);
};
const rows = Array.from({ length: 12 }, (_, i) => ({ driver_id: i + 1, position: i + 1, points: 50 - i }));
const payload = { source_status:"official",event_id:"fictional-event",session_id:"race",source_url:"https://www.indycar.com/results/2027/fictional/race",official_evidence:{kind:"html_header",header:"OFFICIAL RESULTS",sha256:"a".repeat(64),source_url:"https://www.indycar.com/results/2027/fictional/race"} };
const preview = { isClean: true, publishRows: rows, winningAverageSpeed: 170, raceName: "Fictional race" };
const context = race => value(`public.get_results_automation_context(${race})`).context_hash;
const stageStatement = (race, key, flags = [], review = preview) => `public.stage_race_results(${race},${literal(hash(key))},${literal(context(race))},${json(payload)},${json(review)},${json(flags)})`;
const stage = (race, key, flags = [], review = preview) => value(stageStatement(race, key, flags, review));
const approvalIds = new Map();
const messageId = sid => {if(!approvalIds.has(sid))approvalIds.set(sid,`admin:${randomUUID()}`);return approvalIds.get(sid);};
const approve = (id,sid,token,who=admin) => value(`public.approve_staged_race_results(${literal(id)},${literal(messageId(sid))},${literal(hash(token))},${literal(who)})`,"authenticated",who);
const publish = (id,sid,token) => value(`public.publish_staged_race_results(${literal(id)},${literal(messageId(sid))},${literal(token)})`,"authenticated",admin);
const parallelSql = statement => new Promise((resolve, reject) => {
  const child = spawn("docker", ["--host", host, ...sqlArgs], { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
  let output = "", errors = "";
  child.stdout.on("data", b => output += b); child.stderr.on("data", b => errors += b);
  child.on("error", reject); child.on("exit", code => code === 0 ? resolve(JSON.parse(output.trim())) : reject(new Error(errors)));
  child.stdin.end(prefix() + `select ${statement};`);
});
let started = false;
try {
  docker(["info", "--format", "{{.ServerVersion}}"]);
  docker(["image", "inspect", image, "--format", "{{.Id}}"]);
  docker(["run", "-d", "--rm", "--pull=never", "--network=none", "--name", name, "-e", "POSTGRES_HOST_AUTH_METHOD=trust", image]); started = true;
  let ready = false;
  for (let n = 0; n < 60; n++) {
    if (docker(["exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"], undefined, true).status === 0) { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(ready, "Disposable database did not become ready.");
  const bootstrap = [
    `create role anon; create role authenticated; create role service_role; create schema auth; create schema extensions;
     create extension pgcrypto with schema extensions; create table auth.users(id uuid primary key);
     create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
     create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;
     grant usage on schema public,auth to anon,authenticated,service_role;`,
    ...["profiles", "drivers", "league_seasons", "app_metadata", "races", "results", "race_driver_groups", "admin_audit_events", "pick_reminders"].map(table => extract("table", table)),
    ...["claim_pick_reminder_delivery", "is_admin", "ensure_race_result_field_snapshot", "refresh_driver_standings_from_published_results", "publish_race_results", "publish_saved_race_results"].map(fn => extract("function", fn)),
    read("supabase/migrations/20261108_results_automation.sql"),
    read("supabase/migrations/20261109_web_push_notifications.sql"),
    `insert into auth.users values(${literal(admin)}),(${literal(participant)});
     insert into public.profiles(id,team_name,full_name,role,is_active) values(${literal(admin)},'Fixture admin','Organizer','admin',true),(${literal(participant)},'Fixture participant','Participant','participant',true);
     insert into public.league_seasons(id,season_year,display_name,status) values(1,2027,'Fictional active season','active'),(2,2026,'Fictional completed season','completed');
     insert into public.drivers(id,driver_name,current_standing,group_number) select n,'Driver '||n,n,((n-1)%6)+1 from generate_series(1,12) n;
     insert into public.races(id,race_name,season_id,round_number,qualifying_start_at,race_date,field_frozen_at) values
      (1,'Fictional race 1',1,1,now()-interval '5 days',now()-interval '4 days',now()-interval '6 days'),
      (2,'Fictional race 2',1,2,now()-interval '3 days',now()-interval '2 days',now()-interval '4 days'),
      (3,'Fictional future race',1,3,now()+interval '3 days',now()+interval '4 days',now()),
      (4,'Fictional completed race',2,1,now()-interval '3 days',now()-interval '2 days',now()-interval '4 days');
     insert into public.race_driver_groups(race_id,driver_id,group_number) select r,d.id,d.group_number from generate_series(1,4) r cross join public.drivers d;`
  ].join("\n");
  sql(bootstrap);
  for (const race of [1, 2, 3, 4]) value(`public.configure_results_monitor(${race},'fictional-event','race','https://www.indycar.com/results/2027/fictional/race',now()-interval '1 day',true)`, "authenticated", admin);
  check("candidate selection excludes future and completed-season races", () => assert.deepEqual(value("public.results_automation_candidates()").races.map(r => r.race_id), [1, 2]));
  check("participant cannot configure or approve a run", () => fails("select public.configure_results_monitor(1,'x','race','https://www.indycar.com/results/x',now(),true);", /Admin access/, "authenticated", participant));
  check("service cannot call the manual or private publication entry point", () => {
    fails(`select public.publish_race_results(1,${json(rows)},170);`, /permission denied/);
    fails(`select results_automation_private.publish_race_results_core(1,${json(rows)},170);`, /permission denied/);
  });
  const statement = stageStatement(1, "concurrent-identical");
  const concurrent = await Promise.all([parallelSql(statement), parallelSql(statement)]);
  const first = concurrent.find(x => x.status === "staged");
  check("concurrent identical ingestion creates exactly one run", () => {
    assert.deepEqual(concurrent.map(x => x.status).sort(), ["already_processed", "staged"]);
    assert.equal(sql("select count(*) from public.staged_race_results;"), "1");
  });
  check("staging never changes results, race status or driver points", () => {
    assert.equal(sql("select count(*) from public.results;"), "0");
    assert.equal(sql("select results_status from public.races where id=1;"), "draft");
    assert.equal(sql("select sum(championship_points) from public.drivers;"), "0");
  });
  let id = first.run.id;
  check("missing or null JWT role cannot bypass approval authorization", () => {
    const result = docker(sqlArgs, `set role authenticated; set request.jwt.claim.role=''; select public.approve_staged_race_results(${literal(id)},'fixture-null-role',${literal(hash('token'))},${literal(admin)});`, true);
    assert.notEqual(result.status, 0); assert.match(result.stderr, /Admin approval required/);
  });


  check("candidate rotation prioritizes a race that has not been checked", () => {
    value("public.results_automation_monitor_result(1,null,null)");
    assert.deepEqual(value("public.results_automation_candidates()").races.map(r => r.race_id), [2]);
  });
  check("unchanged review retains its immutable run", () => {
    const before = sql("select count(*) from public.staged_race_results;");
    const same = value(`public.revalidate_staged_race_results(${literal(id)},${literal(context(1))},${json(preview)},'[]')`, "authenticated", admin);
    assert.equal(same.run_id, id);
    assert.equal(sql("select count(*) from public.staged_race_results;"), before);
  });
  approve(id, "fixture-same-context", "same-context-token");
  const oldId = id;
  const revised = value(`public.revalidate_staged_race_results(${literal(id)},${literal(context(1))},${json({ ...preview, winningAverageSpeed: 171 })},'[]')`, "authenticated", admin);
  id = revised.run_id;
  check("a same-context preview recheck invalidates old approvals", () => fails(`select public.publish_staged_race_results(${literal(oldId)},'fixture-same-context','same-context-token');`, /expired/));
  approve(id, "fixture-first-approval", "old-token");
  const flagged = stage(1, "flagged", [{ code: "unmapped", message: "Unmapped fixture driver" }]);
  check("flags route to review and supersede earlier clean approval", () => {
    assert.equal(flagged.run.status, "NEEDS_REVIEW");
    assert.equal(approve(flagged.run.id, 'fixture-flagged', 'token').status, 'blocked');
    fails(`select public.publish_staged_race_results(${literal(id)},'fixture-first-approval','old-token');`, /Unresolved flags/);
    assert.equal(sql("select count(*) from public.results;"), "0");
  });
  const newReview = value(`public.revalidate_staged_race_results(${literal(flagged.run.id)},${literal(context(1))},${json(preview)},'[]')`, "authenticated", admin);
  check("a blocked Admin approval cannot gain authority after review", () => {
    assert.notEqual(newReview.run_id, flagged.run.id);
    assert.equal(approve(flagged.run.id, "fixture-flagged", "token").status, "blocked");
    assert.equal(approve(newReview.run_id, "fixture-flagged", "token").status, "blocked");
    fails(`select public.publish_staged_race_results(${literal(flagged.run.id)},'fixture-flagged','token');`, /valid approval/);
  });
  check("old Admin forms cannot approve a revalidated preview under the previous run ID", () => {
    assert.equal(approve(oldId, "fixture-old-browser-form", "browser-token").status, "blocked");
    assert.equal(stage(1, "flagged").run.id, newReview.run_id);
  });
  const manualRows = rows.slice(0, 11);
  check("manual fallback still zero-fills a standard nonstarter and supersedes staged data", () => {
    assert.equal(value(`public.publish_race_results(1,${json(manualRows)},170)`, "authenticated", admin), 12);
    assert.equal(sql("select points from public.results where race_id=1 and driver_id=12;"), "0");
    assert.equal(sql(`select status from public.staged_race_results where id=${literal(flagged.run.id)};`), "SUPERSEDED");
  });
  const clean = stage(2, "clean-second-race");
  let second = clean.run.id;
  check("approval IDs cannot be reused for another run", () => assert.equal(approve(second, 'fixture-first-approval', 'old-token').status, 'blocked'));
  approve(second, "fixture-before-field-change", "before-change");
  sql("update public.races set race_name='Fictional race revised' where id=2;");
  check("context changes invalidate an existing approval", () => fails(`select public.publish_staged_race_results(${literal(second)},'fixture-before-field-change','before-change');`, /context changed/));
  check("pausing and resuming the same source preserves approval context and preview",()=>{
    const before=context(2);
    value("public.configure_results_monitor(2,'fictional-event','race','https://www.indycar.com/results/2027/fictional/race',null,false)","authenticated",admin);
    assert.equal(context(2),before);
    assert.equal(sql(`select status from public.staged_race_results where id=${literal(second)};`),'READY_TO_PUBLISH');
    value("public.configure_results_monitor(2,'fictional-event','race','https://www.indycar.com/results/2027/fictional/race',now()+interval '1 day',true)","authenticated",admin);
    assert.equal(context(2),before);
    assert.equal(sql("select official_staged_at is not null from public.race_result_sources where race_id=2;"),'t');
  });
  const previousSecond = second;
  second = value(`public.revalidate_staged_race_results(${literal(second)},${literal(context(2))},${json(preview)},'[]')`, "authenticated", admin).run_id;
  check("review refresh cannot revive an older approval token", () => fails(`select public.publish_staged_race_results(${literal(previousSecond)},'fixture-before-field-change','before-change');`, /expired/));
  approve(second, "fixture-expiring-approval", "expiring");
  sql(`update public.race_result_approvals set expires_at=now()-interval '1 minute' where message_id=${literal(messageId('fixture-expiring-approval'))};`);
  check("expired approval cannot publish", () => fails(`select public.publish_staged_race_results(${literal(second)},'fixture-expiring-approval','expiring');`, /expired/));
  sql(`update public.profiles set is_active=false where id=${literal(admin)};`);
  check("commissioner participation eligibility does not revoke administrator approval", () => {
    assert.equal(approve(second, "fixture-final-approval", "final-token").status, "approved");
  });
  check("wrong approval token cannot publish", () => fails(`select public.publish_staged_race_results(${literal(second)},'fixture-final-approval','wrong-token');`, /valid approval/));
  const published = publish(second, "fixture-final-approval", "final-token");
  check("approved publication atomically updates results, standings and audit", () => {
    assert.equal(published.status, "published"); assert.equal(published.result_count, 12);
    assert.equal(sql("select results_status from public.races where id=2;"), "published");
    assert.equal(sql("select count(*) from public.results where race_id=2;"), "12");
    assert.equal(sql("select championship_points from public.drivers where id=1;"), "100");
    assert.equal(sql("select championship_points from public.drivers where id=12;"), "39");
    assert.equal(sql("select count(*) from public.admin_audit_events where action='publish_staged_results';"), "1");
  });

  check("replayed approval never republishes or duplicates the audit", () => {
    assert.equal(publish(second, "fixture-final-approval", "final-token").status, "already_processed");
    assert.equal(sql("select count(*) from public.admin_audit_events where action='publish_staged_results';"), "1");
  });
  sql("update public.races set race_date=now()-interval '1 day',qualifying_start_at=now()-interval '2 days' where id=3;");
  const matched=stage(3,"manual-matching-preview").run.id;
  value(`public.publish_race_results(3,${json(rows)},170)`,"authenticated",admin);
  check("manual publication recognizes the identical clean staged preview",()=>assert.equal(sql(`select status from public.staged_race_results where id=${literal(matched)};`),"PUBLISHED"));
  sql("insert into public.races(id,race_name,season_id,round_number,qualifying_start_at,race_date,field_frozen_at) values(5,'Calendar boundary',1,5,now()-interval '2 days',now()-interval '149 minutes',now()-interval '3 days'); insert into public.race_driver_groups(race_id,driver_id,group_number) select 5,id,group_number from public.drivers;");
  value("public.configure_results_monitor(5,'fictional-event','race','https://www.indycar.com/results/2027/fictional/race',null,true)","authenticated",admin);
  check("calendar checking starts at green flag plus two and a half hours",()=>{
    assert.equal(value("public.results_automation_candidates()").races.length,0);
    sql("update public.races set race_date=now()-interval '150 minutes' where id=5;");
    assert.deepEqual(value("public.results_automation_candidates()").races.map(r=>r.race_id),[5]);
  });
  check("claiming a batch does not mark unattempted races checked",()=>{
    const before=sql("select last_checked_at is null from public.race_result_sources where race_id=5;");
    const batch=value("public.results_automation_candidates(true)").races;
    assert.equal(sql("select last_checked_at is null from public.race_result_sources where race_id=5;"),before);
    const attempted=batch.find(r=>r.race_id===5);
    value(`public.results_automation_monitor_result(5,null,${literal(attempted.poll_token)})`);
    assert.equal(sql("select last_checked_at is not null from public.race_result_sources where race_id=5;"),'t');
    sql("update public.race_result_sources set next_poll_at=null where race_id=5;");
  });
  const beforeDry=sql("select to_jsonb(x)::text from public.race_result_sources x where race_id=5;");
  value("public.results_automation_candidates(false)");
  check("dry-run candidate lookup changes no polling state",()=>assert.equal(sql("select to_jsonb(x)::text from public.race_result_sources x where race_id=5;"),beforeDry));
  const claimed=value("public.results_automation_candidates(true)").races[0];
  check("concurrent or early checks cannot claim the same fifteen-minute slot",()=>assert.equal(value("public.results_automation_candidates(true)").races.length,0));
  value(`public.stage_race_results(5,${literal(hash('provisional'))},${literal(context(5))},${json({...payload,source_status:'provisional',official_evidence:null})},${json({...preview,isClean:false})},${json([{code:'not_official',message:'Awaiting official'}])})`);
  check("provisional staging keeps detection armed",()=>assert.equal(sql("select official_staged_at is null from public.race_result_sources where race_id=5;"),'t'));
  value(`public.results_automation_monitor_result(5,null,${literal(claimed.poll_token)})`);
  sql("update public.race_result_sources set next_poll_at=now()-interval '1 second' where race_id=5;");
  check("provisional results get another check after the cadence",()=>assert.deepEqual(value("public.results_automation_candidates()").races.map(r=>r.race_id),[5]));
  stage(5,"official-with-flags",[{code:"mapping",message:"Review required"}],{...preview,isClean:false});
  check("official staging stops polling even while mapping needs Admin review",()=>assert.equal(value("public.results_automation_candidates()").races.length,0));
  value("public.configure_results_monitor(5,'new-source','race','https://www.indycar.com/results/2027/new-source/race',null,true)","authenticated",admin);
  stage(5,"official-with-flags",[{code:"mapping",message:"Review required"}],{...preview,isClean:false});
  check("old payload replay cannot stop a newly configured source",()=>assert.equal(sql("select official_staged_at is null from public.race_result_sources where race_id=5;"),'t'));
  sql("update public.races set race_date=now()+interval '1 day' where id=5;");
  check("a postponed calendar race goes back to sleep",()=>assert.equal(value("public.results_automation_candidates()").races.length,0));
  const dispatcherSource=read("supabase/operations/04_configure_results_monitor_cron.sql");
  const dispatcherStart=dispatcherSource.indexOf("create or replace function public.dispatch_due_results_monitor()");
  const dispatcherEnd=dispatcherSource.indexOf("\n$$;",dispatcherStart)+4;
  sql(`create schema vault;create table vault.decrypted_secrets(name text unique,decrypted_secret text);insert into vault.decrypted_secrets values('mound_hounds_results_github_token','fictional-scoped-token-for-local-tests');
    create schema cron;create table cron.job(jobid bigint primary key,jobname text);create table cron.job_run_details(runid bigint generated always as identity,jobid bigint,status text,end_time timestamptz);
    insert into cron.job values(1,'official_results_calendar'),(2,'unrelated_job');
    insert into cron.job_run_details(jobid,status,end_time) values(1,'succeeded',now()-interval '2 days'),(1,'failed',now()-interval '8 days'),(1,'failed',now()-interval '2 days'),(1,'running',null),(2,'succeeded',now()-interval '100 days');
    create type extensions.http_header as(field varchar,value varchar);
    create type extensions.http_request as(method text,uri varchar,headers extensions.http_header[],content_type varchar,content varchar);
    create type extensions.http_response as(status integer,content_type varchar,headers extensions.http_header[],content varchar);
    create table public.mock_dispatch_settings(status integer,raises boolean);insert into public.mock_dispatch_settings values(204,false);
    create table public.mock_dispatch_requests(id bigint generated always as identity,url text,body jsonb);
    create function extensions.http_set_curlopt(varchar,varchar)returns boolean language sql as $$select true$$;
    create function extensions.http_reset_curlopt()returns boolean language sql as $$select true$$;
    create function extensions.http(request extensions.http_request)returns extensions.http_response language plpgsql as $$begin
      if(select raises from public.mock_dispatch_settings) then raise exception 'fictional transport failure';end if;
      insert into public.mock_dispatch_requests(url,body)values(request.uri,request.content::jsonb);
      return row((select status from public.mock_dispatch_settings),'application/json',null,'')::extensions.http_response;
    end;$$;`+dispatcherSource.slice(dispatcherStart,dispatcherEnd));
  check("off-window clock makes no external dispatch and bounds only its own history",()=>{
    assert.equal(sql("select public.dispatch_due_results_monitor();"),'0');
    assert.equal(sql("select count(*) from public.mock_dispatch_requests;"),'0');
    assert.equal(sql("select count(*) from cron.job_run_details;"),'3');
    assert.equal(sql("select count(*) from cron.job_run_details where jobid=2;"),'1');
    assert.equal(sql("select count(*) from cron.job_run_details where status='running';"),'1');
  });
  sql("update public.races set race_date=now()-interval '151 minutes' where id=5;update public.race_result_sources set next_poll_at=null,poll_token=null,poll_lease_expires_at=null,dispatch_requested_at=null where race_id=5;");
  check("calendar dispatch wakes one worker and cools down without claiming the source",()=>{
    assert.equal(sql("select public.dispatch_due_results_monitor();"),'1');
    assert.equal(sql("select public.dispatch_due_results_monitor();"),'0');
    assert.equal(sql("select count(*) from public.mock_dispatch_requests;"),'1');
    assert.equal(sql("select dispatch_error_code is null and dispatch_accepted_at is not null from public.race_result_sources where race_id=5;"),'t');
    assert.deepEqual(value("public.results_automation_candidates()").races.map(r=>r.race_id),[5]);
  });
  check("accepted jobs that never check in appear in Admin diagnostics",()=>{
    sql("update public.race_result_sources set dispatch_accepted_at=now()-interval '11 minutes',last_checked_at=null where race_id=5;");
    assert.equal(sql("select public.dispatch_due_results_monitor();"),'0');
    assert.equal(sql("select dispatch_error_code from public.race_result_sources where race_id=5;"),'dispatch_worker_missing');
    value("public.results_automation_candidates(true)");
    assert.equal(sql("select dispatch_error_code is null from public.race_result_sources where race_id=5;"),'t');
  });
  for(const [status,expected] of [[401,'dispatch_auth'],[403,'dispatch_auth'],[404,'dispatch_setup'],[422,'dispatch_setup'],[429,'dispatch_unavailable'],[503,'dispatch_unavailable']])check(`GitHub status ${status} records a safe actionable failure`,()=>{
    sql(`update public.mock_dispatch_settings set status=${status};update public.race_result_sources set next_poll_at=null,poll_lease_expires_at=null,dispatch_requested_at=null where race_id=5;`);
    assert.equal(sql("select public.dispatch_due_results_monitor();"),'0');
    assert.equal(sql("select dispatch_error_code from public.race_result_sources where race_id=5;"),expected);
  });
  check("a dispatch timeout records only a safe retry code",()=>{
    sql("update public.mock_dispatch_settings set raises=true;update public.race_result_sources set dispatch_requested_at=null where race_id=5;");
    assert.equal(sql("select public.dispatch_due_results_monitor();"),'0');
    assert.equal(sql("select dispatch_error_code from public.race_result_sources where race_id=5;"),'dispatch_unavailable');
  });
  check("minute calendar ticks preserve a delayed worker's fifteen-minute source gate",()=>{
    assert.match(dispatcherSource,/cron.schedule\('official_results_calendar','\* \* \* \* \*'/);
    sql("update public.mock_dispatch_settings set status=204,raises=false;update public.race_result_sources set dispatch_requested_at=now()-interval '18 minutes',next_poll_at=now()+interval '1 minute',poll_lease_expires_at=null where race_id=5;");
    assert.equal(sql("select public.dispatch_due_results_monitor();"),'0');
    sql("update public.race_result_sources set next_poll_at=now()-interval '1 second' where race_id=5;");
    assert.equal(sql("select public.dispatch_due_results_monitor();"),'1');
  });
  check("clock retention is daily, capped and leaves unrelated jobs alone",()=>{
    sql("delete from public.app_metadata where key='results_clock_cleanup_day';insert into cron.job_run_details(jobid,status,end_time)select 1,'succeeded',now()-interval '2 days' from generate_series(1,2100);");
    sql("select public.dispatch_due_results_monitor();");
    assert.equal(sql("select count(*) from cron.job_run_details where jobid=1 and status='succeeded';"),'100');
    sql("select public.dispatch_due_results_monitor();");
    assert.equal(sql("select count(*) from cron.job_run_details where jobid=1 and status='succeeded';"),'100');
    assert.equal(sql("select count(*) from cron.job_run_details where jobid=2;"),'1');
  });
  check("unattempted races rotate first after a bounded worker batch",()=>{
    sql("update public.race_result_sources set next_poll_at=now()+interval '1 day' where race_id=5;insert into public.races(id,race_name,season_id,round_number,qualifying_start_at,race_date)select n,'Budget fixture '||n,1,n,now()-interval '2 days',now()-interval '1 day'+n*interval '1 minute' from generate_series(10,19)n;insert into public.race_result_sources(race_id,event_id,session_id,source_url,monitor_enabled)select n,'budget-'||n,'race','https://www.indycar.com/results/2027/budget-'||n||'/race',true from generate_series(10,19)n;");
    const batch=value("public.results_automation_candidates(true)").races;
    assert.equal(batch.length,10);
    for(const race of batch.slice(0,3))value(`public.results_automation_monitor_result(${race.race_id},null,${literal(race.poll_token)})`);
    sql("update public.race_result_sources set next_poll_at=null,poll_lease_expires_at=null where race_id between 10 and 19;");
    assert.deepEqual(value("public.results_automation_candidates()").races.map(r=>r.race_id),[13,14,15,16,17,18,19,10,11,12]);
  });
  const device = user => `insert into public.push_subscriptions(user_id,endpoint,p256dh,auth) values(${literal(user)},'https://fcm.googleapis.com/fcm/send/fixture-'||extensions.gen_random_uuid(),'${"a".repeat(87)}','${"b".repeat(22)}');`;
  sql("grant usage on schema extensions to authenticated;");
  sql(prefix("authenticated",participant)+device(participant));
  check("device RLS hides another account and rejects ownership forgery",()=>{
    assert.equal(sql(prefix("authenticated",admin)+"select count(*) from public.push_subscriptions;"),"0");
    fails(device(admin),/row-level security/,"authenticated",participant);
    fails("update public.push_subscriptions set last_delivered_at=now();",/permission denied/,"authenticated",participant);
  });
  const endpoint=sql(`select endpoint from public.push_subscriptions where user_id=${literal(participant)} limit 1;`);
  check("test pushes have atomic account cooldown independent of device deletion",()=>{
    assert.equal(value(`public.claim_push_test(${literal(endpoint)})`,"authenticated",participant),true);
    assert.equal(value(`public.claim_push_test(${literal(endpoint)})`,"authenticated",participant),false);
    sql(prefix("authenticated",participant)+`delete from public.push_subscriptions;`+device(participant));
    const replacement=sql(`select endpoint from public.push_subscriptions where user_id=${literal(participant)} limit 1;`);
    assert.equal(value(`public.claim_push_test(${literal(replacement)})`,"authenticated",participant),false);
  });
  check("device registrations are bounded and cascade with account cleanup",()=>{
    for(let n=1;n<10;n++)sql(prefix("authenticated",participant)+device(participant));
    fails(device(participant),/Device limit/,"authenticated",participant);
    sql(`delete from public.profiles where id=${literal(participant)};`);
    assert.equal(sql("select count(*) from public.push_subscriptions;"),"0");
  });
  check("email and push claims are independent for one reminder window",()=>{
    assert.equal(typeof value(`public.claim_pick_reminder_delivery(3,${literal(admin)},'2d','email','fixture@example.test')`),"number");
    assert.equal(typeof value(`public.claim_pick_reminder_delivery(3,${literal(admin)},'2d','push','web-push')`),"number");
    assert.equal(sql("select count(*) from public.pick_reminders;"),"2");
  });
  console.log(`PASS: ${checks} isolated PostgreSQL results-automation checks; no external networking or real league data.`);
} finally {
  if (started) docker(["stop", "--time", "1", name]);
}

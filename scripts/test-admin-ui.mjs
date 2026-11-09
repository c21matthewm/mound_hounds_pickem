import assert from "node:assert/strict";
import { readFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// A component-only browser suite: no Next server, .env loading, Supabase client,
// real authentication, email delivery, or browser networking. The optional root
// argument lets maintainers validate a staged runner against a local checkout.
const root = process.argv[2] ? path.resolve(process.argv[2]) : fileURLToPath(new URL("..", import.meta.url));
const fixture = fileURLToPath(new URL("../tests/browser/admin-ui-fixture.jsx", import.meta.url));
const requireFromRepo = createRequire(path.join(root, "package.json"));
const { build } = await import(pathToFileURL(requireFromRepo.resolve("vite")).href);
const { chromium } = requireFromRepo("playwright");
const { default: tailwind } = await import(pathToFileURL(requireFromRepo.resolve("@tailwindcss/postcss")).href);
const work = mkdtempSync(path.join(tmpdir(), "mound-admin-ui-"));
const folder = path.join(work, "build");
const output = path.join(work, "screenshots");
const emptyEnv = path.join(work, "empty-env");
mkdirSync(emptyEnv);
mkdirSync(output);
const sourceRoot = path.join(root, "src");
const globalsPath = path.join(sourceRoot, "app", "globals.css");
const normalized = value => value.replaceAll("\\", "/");
const resolveSource = id => id.startsWith("@/") ? path.join(sourceRoot, id.slice(2)) : id;
await build({
  configFile: false,
  envDir: emptyEnv,
  envPrefix: [],
  root,
  publicDir: false,
  cacheDir: path.join(work, "cache"),
  logLevel: "warn",
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  resolve: { alias: { "@": sourceRoot }, dedupe: ["react", "react-dom"] },
  // Load the installed CSS plugin explicitly; do not evaluate repository Vite or
  // PostCSS configuration, which could have unrelated environment side effects.
  css: { postcss: { plugins: [tailwind({ base: root })] } },
  plugins: [{
    name: "offline-admin-fixture-boundaries",
    enforce: "pre",
    resolveId(source) {
      const id = resolveSource(source);
      if (normalized(id).includes("/app/admin/") && /actions(?:\.ts)?$/.test(id)) return "\0fixture-action:" + id;
      if (normalized(id).endsWith("/app/admin/admin-data") || normalized(id).endsWith("/app/admin/admin-data.ts")) return "\0fixture:admin-data";
      if(normalized(id).endsWith("/components/pwa-provider")||normalized(id).endsWith("/components/pwa-provider.tsx"))return "\0fixture:pwa";
      if (source === "next/link" || source === "next/navigation") return "\0fixture:" + source;
      if (source === "server-only" || source.startsWith("@supabase/") || normalized(id).includes("/lib/supabase/")) {
        throw new Error("An offline fixture reached a server boundary. Add an explicit fixture mock before proceeding.");
      }
    },
    load(id) {
      if (id.startsWith("\0fixture-action:")) {
        const file = id.slice("\0fixture-action:".length).replace(/\.ts$/, "") + ".ts";
        const names = [...readFileSync(file, "utf8").matchAll(/export async function (\w+)/g)].map(match => match[1]);
        assert.ok(names.length, `No exported action found in ${path.basename(file)}`);
        return names.map(name => `export async function ${name}(...args) {
          const form = args.find(arg => arg instanceof FormData);
          const fields = form ? Object.fromEntries([...form].map(([key,value]) => [key, value instanceof File ? {name:value.name,type:value.type,size:value.size} : value])) : {};
          window.fixtureCalls.push({name:${JSON.stringify(name)},fields});
          return {ok:true,status:'success',message:'Fixture save complete',seasonYear:2024};
        }`).join("\n");
      }
      if(id === "\0fixture:pwa")return "export const usePwa=()=>window.fixturePwa??{isOffline:false,isStandalone:false,needsHttps:false};";
      if (id === "\0fixture:admin-data") return "export const formatDateTime=value=>value.slice(0,10);";
      if (id === "\0fixture:next/link") return "import {createElement} from 'react';export default function Link({children,href,...props}){return createElement('a',{href,...props},children)}";
      if (id === "\0fixture:next/navigation") return "export const useRouter=()=>({push:(url)=>window.fixtureNavigation=url,refresh:()=>{}});";
    },
    transform(code, id) {
      if (normalized(id) === normalized(globalsPath)) {
        // Scan component source only, keeping dotenv files and unrelated folders
        // out of Tailwind discovery while using the application's actual CSS.
        return code.replace('@import "tailwindcss";', `@import "tailwindcss" source(none);\n@source ${JSON.stringify(normalized(sourceRoot))};`);
      }
    }
  }],
  oxc: { jsx: { runtime: "automatic" } },
  build: {
    outDir: folder,
    emptyOutDir: false,
    minify: false,
    lib: { entry: fixture, name: "AdminFixture", formats: ["iife"], fileName: "fixture", cssFileName: "fixture" }
  }
});
const css = readFileSync(path.join(folder, "fixture.css"), "utf8");
const js = readFileSync(path.join(folder, "fixture.iife.js"), "utf8");
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ offline: true, serviceWorkers: "block" });
const blockedRequests = [];
await context.route("**/*", route => { blockedRequests.push(route.request().method()); return route.abort(); });
let checks = 0;
const errors = [];
try {
 async function scene(name,width=390){
  const page=await context.newPage();
  await page.setViewportSize({width,height:900});
  page.setDefaultTimeout(10_000);
  page.on('pageerror',error=>errors.push(error.message));
  await page.setContent('<html><head><meta http-equiv="Content-Security-Policy" content="default-src &apos;none&apos;; script-src &apos;unsafe-inline&apos;; style-src &apos;unsafe-inline&apos;; img-src data: blob:; connect-src &apos;none&apos;"><style>'+css+'</style></head><body><div id="root"></div></body></html>');
  await page.evaluate(()=>{window.fixtureCalls=[];window.confirm=()=>true;Object.defineProperty(navigator,'onLine',{configurable:true,value:true});});
  if(name.startsWith('push'))await page.evaluate(name=>{
    window.fixturePwa={isOffline:false,isStandalone:name!=='pushInstall',needsHttps:false};
    window.fixturePush=[];window.fixturePushEnabled=false;window.fixturePushSub=null;window.fixtureWorkerResponds=name!=='pushRetry';window.fixtureRegisterResponds=name!=='pushRegister';
    const sub={endpoint:'https://fcm.googleapis.com/fcm/send/fixture',toJSON:()=>({endpoint:sub.endpoint,keys:{p256dh:'fixture',auth:'fixture'}}),unsubscribe:async()=>{window.fixturePush.push('unsubscribe');window.fixturePushSub=null;return true;}};
    const registration={waiting:name==='pushUpdate'?{state:'installed'}:null,active:{postMessage:(message,ports)=>{if(name==='pushUpdate')return;setTimeout(()=>ports[0].postMessage({push:window.fixtureWorkerResponds}),name==='pushDelayed'?2500:0);}},pushManager:{getSubscription:async()=>window.fixturePushSub,subscribe:async options=>{if(options.userVisibleOnly!==true)throw Error('Invisible subscription');window.fixturePush.push('subscribe');window.fixturePushSub=sub;return sub;}}};
    Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{ready:Promise.resolve(registration),getRegistration:async()=>registration,register:async()=>{window.fixturePush.push('register');if(!window.fixtureRegisterResponds)return new Promise(()=>{});return registration;}}});
    window.PushManager=function(){};
    window.Notification={permission:name==='pushDenied'?'denied':'default',requestPermission:async()=>{window.fixturePush.push('permission');window.Notification.permission=name==='pushDismiss'?'default':'granted';return window.Notification.permission;}};
    window.fetch=async(url,options={})=>{if(!String(url).startsWith('/api/push/'))throw Error('Unexpected push fixture request');const input=options.body?JSON.parse(options.body):{};let data={configured:true,publicKey:'BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',enabled:window.fixturePushEnabled,pickDeliveryEnabled:name!=='pushSettings'};
      if(options.method==='DELETE'){window.fixturePush.push('DELETE');window.fixturePushEnabled=false;data={enabled:false};}
      else if(input.action==='status')data={enabled:window.fixturePushEnabled};
      else if(options.method==='POST'){window.fixturePush.push(url.endsWith('/test')?'test':'POST');window.fixturePushEnabled=true;data={enabled:true,sent:true};}
      return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});};
  },name);
  await page.addScriptTag({content:js});
  await page.evaluate(name=>window.showScene(name),name);
  await page.locator('main').waitFor();
  return page;
 }
 for(const name of ['results','drivers','historical','invite','participants','bulk','rules','closeout','offseason','recoveryOffseason','recoveryPast','recoveryActive','recoveryRetention','recoveryRetentionPast','recoveryRetentionMissing'])for(const width of [320,375,390,768,1280]){
  const page=await scene(name,width);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
  assert.equal(overflow,false,`${name} overflow at ${width}`);checks++;
  if(width===390||width===1280)await page.screenshot({path:`${output}/${name}-${width}.png`,fullPage:true});
  await page.close();
 }
 let page=await scene('pushInstall');
 await page.getByRole('link',{name:'How to install'}).waitFor();
 assert.deepEqual(await page.evaluate(()=>window.fixturePush),[]);checks++;await page.close();
 page=await scene('pushSettings');const enablePush=page.getByRole('button',{name:'Enable notifications'});
 await enablePush.waitFor();await page.waitForFunction(()=>!document.querySelector('button')?.disabled);
 assert.deepEqual(await page.evaluate(()=>window.fixturePush),['register']);checks++;
 assert.equal(await page.getByText(/Email|administrators|staged-results/).count(),0);checks++;
 await page.getByText('Pick reminders haven’t started yet.',{exact:true}).waitFor();checks++;
 await page.screenshot({path:output+'/push-off-390.png',fullPage:true});
 await enablePush.click();await page.getByRole('button',{name:'Send test notification'}).waitFor();
 assert.deepEqual(await page.evaluate(()=>window.fixturePush),['register','permission','subscribe','POST']);checks++;
 await page.screenshot({path:output+'/push-on-390.png',fullPage:true});
 await page.getByRole('button',{name:'Send test notification'}).click();await page.getByText('Test sent. Check your notifications.',{exact:true}).waitFor();checks++;
 await page.getByRole('button',{name:'Disable notifications'}).click();await enablePush.waitFor();
 assert.deepEqual((await page.evaluate(()=>window.fixturePush)).slice(-2),['DELETE','unsubscribe']);checks++;
 await page.setViewportSize({width:320,height:900});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);checks++;await page.close();
 page=await scene('pushDenied');await page.getByText('Notifications are blocked.',{exact:false}).waitFor();assert.deepEqual(await page.evaluate(()=>window.fixturePush.filter(action=>action!=='register')),[]);checks++;await page.close();
 for(const name of ['pushDelayed']){
  page=await scene(name);const enable=page.getByRole('button',{name:'Enable notifications',exact:true});
  await enable.waitFor();await page.waitForFunction(()=>!document.querySelector('button')?.disabled);
  assert.deepEqual(await page.evaluate(()=>window.fixturePush),['register']);checks++;
  await enable.click();await page.getByRole('button',{name:'Send test notification'}).waitFor();
  assert.equal(await page.getByText(/Close Mound Hounds|reopen/i).count(),0);checks++;
  assert.deepEqual(await page.evaluate(()=>window.fixturePush),['register','permission','subscribe','POST']);checks++;
  await page.close();
 }
 page=await scene('pushUpdate');await page.getByText('An app update is ready.',{exact:false}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Enable notifications',exact:true}).count(),0);checks++;
 assert.deepEqual(await page.evaluate(()=>window.fixturePush),['register']);checks++;await page.close();
 page=await scene('pushRetry');await page.getByRole('button',{name:'Try again',exact:true}).waitFor();
 assert.equal(await page.getByText(/Close Mound Hounds|reopen/i).count(),0);checks++;
 await page.evaluate(()=>{window.fixtureWorkerResponds=true;});await page.getByRole('button',{name:'Try again',exact:true}).click();
 await page.waitForFunction(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent==='Enable notifications');return b&&!b.disabled;});
 assert.deepEqual(await page.evaluate(()=>window.fixturePush),['register','register']);checks++;await page.close();
 page=await scene('pushRegister');await page.getByRole('button',{name:'Try again',exact:true}).waitFor({timeout:15000});
 assert.deepEqual(await page.evaluate(()=>window.fixturePush),['register']);checks++;
 await page.evaluate(()=>{window.fixtureRegisterResponds=true;});await page.getByRole('button',{name:'Try again',exact:true}).click();
 await page.waitForFunction(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent==='Enable notifications');return b&&!b.disabled;});
 assert.deepEqual(await page.evaluate(()=>window.fixturePush),['register','register']);checks++;await page.close();
 page=await scene('pushDismiss');await page.waitForFunction(()=>!document.querySelector('button')?.disabled);
 await page.getByRole('button',{name:'Enable notifications',exact:true}).click();await page.getByText('Notifications are still off.',{exact:false}).waitFor();
 assert.deepEqual(await page.evaluate(()=>window.fixturePush),['register','permission']);checks++;await page.close();
 page=await scene('results');

 const paste=page.getByTestId('admin-results-import-paste');
 const preview=page.getByTestId('admin-results-import-preview');
 const publish=page.getByTestId('admin-results-import-submit');
 const resultText=await page.evaluate(()=>window.fixtureResultsPaste);
 assert.equal(await publish.isDisabled(),true);
 await paste.fill(resultText);await preview.click();
 await page.getByText('Preview is clean. Ready to publish.',{exact:true}).waitFor();
 assert.equal(await publish.isEnabled(),true);checks++;
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);checks++;
 await paste.fill(resultText+'\n');
 await page.getByText('Preview is stale. Run preview again before publishing.',{exact:true}).waitFor();
 assert.equal(await publish.isDisabled(),true);checks++;
 await paste.fill(resultText.replace('Fixture Driver 1\t','Unknown Fixture Driver\t'));await preview.click();
 assert.equal(await publish.isDisabled(),true);checks++;
 await paste.fill(resultText.split('\n').slice(0,-1).join('\n'));await preview.click();
 assert.equal(await publish.isEnabled(),true);
 await page.getByText('These pickable drivers are absent from the official finishing order and will receive 0 points.',{exact:false}).waitFor();checks++;
 await publish.click();await page.waitForFunction(()=>window.fixtureCalls.length===1);
 assert.equal((await page.evaluate(()=>window.fixtureCalls[0])).fields.race_id,'1');checks++;
 await page.close();
 page=await scene('drivers');
 await page.getByLabel('Driver draft').fill('Edited but unsaved');
 await page.getByLabel('Select Fixture A',{exact:true}).check();
 await page.getByLabel('Missing photos (1)',{exact:true}).check();
 await page.getByText('1 selected · 1 hidden by photo filter',{exact:true}).waitFor();
 await page.getByLabel('All drivers (2)',{exact:true}).check();
 assert.equal(await page.getByLabel('Driver draft').inputValue(),'Edited but unsaved');checks++;
 await page.getByLabel('Missing photos (1)',{exact:true}).check();await page.getByRole('button',{name:'Select shown',exact:true}).click();
 await page.getByLabel('Roster action').selectOption('deactivate');
 await page.getByRole('button',{name:'Apply to selected'}).click();
 await page.waitForFunction(()=>window.fixtureCalls.length===1);
 let call=await page.evaluate(()=>window.fixtureCalls[0]);assert.equal(call.name,'bulkUpdateDriverRosterAction');assert.equal(call.fields.operation,'deactivate');assert.deepEqual(JSON.parse(call.fields.selected_drivers),[{id:2,expected_is_active:false}]);checks++;
 await page.evaluate(()=>{window.confirm=()=>false;});await page.getByRole('button',{name:'Apply to selected'}).click();assert.equal(await page.evaluate(()=>window.fixtureCalls.length),1);checks++;await page.close();
 page=await scene('historical');
 await page.getByLabel('Season year',{exact:true}).fill('2024');await page.getByLabel('Number of races',{exact:true}).fill('2');
 await page.getByLabel('Final leaderboard',{exact:true}).fill('Rank\tTeam Name\tTotal Points\n1\tFixture Champion\t100\n2\tFixture Runner\t90');
 const submit=page.getByRole('button',{name:'Import season into Hall of Fame'});assert.equal(await submit.isDisabled(),true);
 await page.getByRole('checkbox').check();assert.equal(await submit.isEnabled(),true);
 await page.getByLabel('Number of races',{exact:true}).fill('3');assert.equal(await page.getByRole('checkbox').isChecked(),false);assert.equal(await submit.isDisabled(),true);checks++;
 await page.getByLabel('Season year',{exact:true}).fill('2025');await page.getByText('2025 is already in Hall of Fame.',{exact:false}).waitFor();assert.equal(await submit.isDisabled(),true);checks++;await page.close();
 page=await scene('invite');await page.getByLabel('Current invite code',{exact:true}).fill('fixture-code-2027');await page.getByRole('button',{name:'Copy registration link'}).click();
 const link=await page.getByLabel('Private registration link',{exact:true}).inputValue();const url=new URL(link);assert.equal(url.search,'');assert.equal(url.hash,'#code=fixture-code-2027');checks++;await page.close();
 page=await scene('bulk');await page.getByLabel('Action for selected accounts',{exact:true}).selectOption('register');await page.getByRole('button',{name:'Apply to selected'}).click();await page.waitForFunction(()=>window.fixtureCalls.length===1);
 call=await page.evaluate(()=>window.fixtureCalls[0]);assert.equal(call.fields.participant_season_id,'8');assert.equal(call.fields.operation,'register');checks++;await page.close();
 page=await scene('rules');await page.getByLabel('Upload 2027 rules PDF',{exact:true}).setInputFiles({name:'wrong.txt',mimeType:'text/plain',buffer:Buffer.from('not a PDF')});assert.equal(await page.getByRole('button',{name:'Upload and publish PDF'}).isDisabled(),true);
 await page.getByLabel('Upload 2027 rules PDF',{exact:true}).setInputFiles({name:'fixture.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7\nfixture\n%%EOF')});await page.getByRole('button',{name:'Upload and publish PDF'}).click();await page.waitForFunction(()=>window.fixtureCalls.length===1);assert.equal((await page.evaluate(()=>window.fixtureCalls[0])).fields.season_id,'7');checks++;await page.close();

  page=await scene('closeout');
  const finish=page.getByRole('button',{name:'Complete 2026 season',exact:true});
  await page.evaluate(()=>{window.confirm=()=>false;});await finish.click();assert.equal(await page.evaluate(()=>window.fixtureCalls.length),0);checks++;
  await page.evaluate(()=>{window.confirm=()=>true;});await finish.click();await page.waitForFunction(()=>window.fixtureCalls.length===1);
  call=await page.evaluate(()=>window.fixtureCalls[0]);assert.equal(call.name,'completeLeagueSeasonAction');assert.equal(call.fields.season_id,'6');assert.equal(call.fields.archive_id,'6');assert.equal(call.fields.confirm_complete,'yes');checks++;
  assert.equal(await page.getByRole('button',{name:'Activate season',exact:true}).isDisabled(),true);checks++;await page.close();
  page=await scene('offseason');await page.getByText('No active season',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Complete 2026 season',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Activate season',exact:true}).isDisabled(),true);checks++;await page.close();
  for (const name of ['recoveryOffseason','recoveryPast','recoveryActive']) {
    page=await scene(name);
    const active=name==='recoveryActive';
    assert.equal(await page.getByRole('button',{name:'Create & Download Backup',exact:true}).isDisabled(),!active);
    assert.equal(await page.getByRole('button',{name:'Download',exact:true}).isEnabled(),true);
    assert.equal(await page.getByLabel('Backup season',{exact:true}).inputValue(),active?'7':'6');
    await page.evaluate(active=>{
      window.fixtureRecovery=[];
      window.fetch=async (url,options)=>{
        if(url!=='/api/admin/season-backups' || options?.method!=='POST') throw new Error('Unexpected recovery fixture request');
        const request=JSON.parse(options.body);window.fixtureRecovery.push(request);
        if(request.action!=='preview' && request.action!=='restore') throw new Error('Unexpected recovery action');
        const data=request.action==='restore'?{safetyPointId:'fixture-safety',restoredAt:'2027-01-01T00:00:00Z'}:
          {id:request.restorePointId,seasonId:active?7:6,seasonYear:active?2027:2026,createdAt:'2026-09-21T12:00:00Z',differences:{races:{backupCount:0,currentCount:0,differentRows:0}}};
        return new Response(JSON.stringify({data}),{headers:{'Content-Type':'application/json'}});
      };
    },active);
    await page.getByRole('button',{name:'Preview Restore',exact:true}).click();
    await page.getByText('Preview loaded.',{exact:false}).waitFor();
    if(active){
      const restore=page.getByRole('button',{name:'Restore This Season',exact:true});
      assert.equal(await restore.isDisabled(),true);
      await page.getByLabel('Type 2027 to confirm',{exact:true}).fill('2027');
      await restore.click();await page.getByText('Season restored successfully.',{exact:false}).waitFor();
      assert.equal((await page.evaluate(()=>window.fixtureRecovery)).at(-1).action,'restore');
    } else {
      assert.equal(await page.getByRole('button',{name:'Restore This Season',exact:true}).count(),0);
      await page.getByText('This season is not active.',{exact:false}).waitFor();
      assert.equal((await page.evaluate(()=>window.fixtureRecovery)).length,1);
    }
    checks++;await page.close();
  }
  async function retentionScene(name='recoveryRetention',width=390) {
    const fixturePage=await scene(name,width);
    await fixturePage.evaluate(()=>{
      window.fixtureRecovery=[];window.fixtureDownloads=[];window.fixtureCleanupError=false;
      // Record download intent without making even a local HTTP request.
      HTMLAnchorElement.prototype.click=function(){window.fixtureDownloads.push(this.getAttribute('href'));};
      window.fetch=async(url,options)=>{
        if(url!=='/api/admin/season-backups'||options?.method!=='POST')throw new Error('Unexpected retention fixture request');
        const request=JSON.parse(options.body);window.fixtureRecovery.push(request);
        let data;
        if(request.action==='retention-preview')data=window.fixtureRetention;
        else if(request.action==='cleanup'){
          if(window.fixtureCleanupError)return new Response(JSON.stringify({error:'Backups changed. Review again before cleanup.'}),{status:400,headers:{'Content-Type':'application/json'}});
          data={deletedCount:2,deletedBytes:2048,retention:{...window.fixtureRetention,totalCount:4,totalBytes:4096,routineCount:3,cleanupCount:0,cleanupBytes:0}};
        }
        else if(request.action==='protect')data={id:request.restorePointId,protected:request.protected,retentionKey:request.protected?'manual:protected':null,retention:window.fixtureRetention};
        else if(request.action==='create')data={id:'00000000-0000-4000-8000-000000000099'};
        else if(request.action==='preview')data={id:request.restorePointId,seasonId:7,seasonYear:2027,createdAt:'2027-01-20T12:00:00Z',differences:{races:{backupCount:0,currentCount:0,differentRows:0}}};
        else throw new Error('Unexpected retention action: '+request.action);
        return new Response(JSON.stringify({data}),{headers:{'Content-Type':'application/json'}});
      };
    });
    return fixturePage;
  }
  page=await retentionScene();
  await page.evaluate(()=>Object.defineProperty(navigator,'onLine',{configurable:true,value:false}));
  await page.getByRole('button',{name:'Review older backups',exact:true}).click();
  await page.getByText('You are offline. Reconnect before managing season recovery.',{exact:true}).waitFor();
  assert.equal((await page.evaluate(()=>window.fixtureRecovery)).length,0);checks++;await page.close();
  for(const name of ['recoveryRetention','recoveryRetentionPast']){
    page=await retentionScene(name,320);
    await page.getByRole('button',{name:'Review older backups',exact:true}).click();
    await page.getByText('This will remove 2 older routine backups',{exact:false}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);checks++;
    await page.evaluate(()=>{window.confirm=()=>false;});
    await page.getByRole('button',{name:'Remove reviewed backups',exact:true}).click();
    assert.equal((await page.evaluate(()=>window.fixtureRecovery)).filter(r=>r.action==='cleanup').length,0);checks++;
    await page.evaluate(()=>{window.confirm=()=>true;});
    await page.getByRole('button',{name:'Remove reviewed backups',exact:true}).click();
    await page.getByText('Removed 2 older routine backups',{exact:false}).waitFor();
    call=(await page.evaluate(()=>window.fixtureRecovery)).at(-1);
    assert.equal(call.action,'cleanup');assert.equal(call.seasonId,7);assert.equal(call.reviewToken,'a'.repeat(64));
    assert.equal(await page.getByRole('combobox',{name:/Restore point/}).inputValue(),'');
    assert.equal(await page.getByRole('button',{name:'Remove reviewed backups',exact:true}).count(),0);checks++;await page.close();
  }
  page=await retentionScene();
  await page.getByRole('button',{name:'Preview Restore',exact:true}).click();
  await page.getByLabel('Type 2027 to confirm',{exact:true}).fill('2027');
  await page.getByRole('button',{name:'Keep permanently',exact:true}).click();
  await page.getByText('This backup will be kept permanently until you release it.',{exact:true}).waitFor();
  call=(await page.evaluate(()=>window.fixtureRecovery)).at(-1);assert.equal(call.action,'protect');assert.equal(call.protected,true);assert.equal(call.restorePointId,'00000000-0000-4000-8000-000000000009');
  assert.equal(await page.getByRole('button',{name:'Restore This Season',exact:true}).count(),0);checks++;
  await page.getByRole('combobox',{name:/Restore point/}).selectOption('00000000-0000-4000-8000-000000000004');
  await page.evaluate(()=>{window.confirm=()=>false;});
  const release=page.getByRole('button',{name:'Return to routine retention',exact:true});await release.click();
  assert.equal((await page.evaluate(()=>window.fixtureRecovery)).filter(r=>r.action==='protect').length,1);checks++;
  await page.evaluate(()=>{window.confirm=()=>true;});await release.click();
  await page.getByText('This backup now follows routine retention. It has not been deleted.',{exact:true}).waitFor();
  call=(await page.evaluate(()=>window.fixtureRecovery)).at(-1);assert.equal(call.protected,false);assert.equal(call.restorePointId,'00000000-0000-4000-8000-000000000004');checks++;
  await page.getByLabel('Keep this backup permanently',{exact:false}).check();
  await page.getByRole('button',{name:'Create & Download Backup',exact:true}).click();
  await page.getByText('Backup created and download started.',{exact:false}).waitFor();
  call=(await page.evaluate(()=>window.fixtureRecovery)).at(-1);assert.equal(call.action,'create');assert.equal(call.keepPermanently,true);assert.equal(call.seasonId,7);
  assert.deepEqual(await page.evaluate(()=>window.fixtureDownloads),['/api/admin/season-backups?id=00000000-0000-4000-8000-000000000099']);checks++;await page.close();
  page=await retentionScene();
  await page.getByRole('button',{name:'Review older backups',exact:true}).click();
  await page.getByRole('button',{name:'Cancel review',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Remove reviewed backups',exact:true}).count(),0);checks++;
  await page.getByRole('button',{name:'Review older backups',exact:true}).click();
  await page.evaluate(()=>{window.fixtureCleanupError=true;});
  await page.getByRole('button',{name:'Remove reviewed backups',exact:true}).click();
  await page.getByText('Backups changed. Review again before cleanup.',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Remove reviewed backups',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'Review older backups',exact:true}).isEnabled(),true);checks++;await page.close();
  page=await retentionScene('recoveryRetentionMissing');
  assert.equal(await page.getByRole('button',{name:'Review older backups',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'Keep permanently',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'Download',exact:true}).isEnabled(),true);
  assert.equal(await page.getByRole('button',{name:'Create & Download Backup',exact:true}).isEnabled(),true);checks++;await page.close();
  assert.deepEqual(errors, [], "Fixture pages raised browser exceptions.");
  assert.deepEqual(blockedRequests, [], "A component attempted a network request; every request was blocked.");
  console.log(`PASS: ${checks} offline rendered layout and interaction checks; no browser network requests permitted. Screenshots: ${output}`);
} finally {
  await browser.close();
}

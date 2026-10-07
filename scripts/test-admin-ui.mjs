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
  await page.evaluate(()=>{window.fixtureCalls=[];window.confirm=()=>true;});
  await page.addScriptTag({content:js});
  await page.evaluate(name=>window.showScene(name),name);
  await page.locator('main').waitFor();
  return page;
 }
 for(const name of ['drivers','historical','invite','participants','bulk','rules','closeout','offseason','recoveryOffseason','recoveryPast','recoveryActive','recoveryRetention','recoveryRetentionPast','recoveryRetentionMissing'])for(const width of [320,375,390,768,1280]){
  const page=await scene(name,width);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
  assert.equal(overflow,false,`${name} overflow at ${width}`);checks++;
  if(width===390||width===1280)await page.screenshot({path:`${output}/${name}-${width}.png`,fullPage:true});
  await page.close();
 }
 let page=await scene('drivers');
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

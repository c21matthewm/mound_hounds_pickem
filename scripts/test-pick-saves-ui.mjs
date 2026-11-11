import assert from "node:assert/strict";
import { readFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Actual PickemForm with fictional props, compiled without env files/services.
// Browser networking is disabled and every attempted request is aborted.
const root = process.argv[2] ? path.resolve(process.argv[2]) : fileURLToPath(new URL("..", import.meta.url));
const fixture = fileURLToPath(new URL("../tests/browser/pick-saves-fixture.jsx", import.meta.url));
const requireFromRepo = createRequire(path.join(root, "package.json"));
const { build } = await import(pathToFileURL(requireFromRepo.resolve("vite")).href);
const { chromium } = requireFromRepo("playwright");
const { default: tailwind } = await import(pathToFileURL(requireFromRepo.resolve("@tailwindcss/postcss")).href);
const work = mkdtempSync(path.join(tmpdir(), "mound-pick-ui-"));
const folder = path.join(work, "build");
const emptyEnv = path.join(work, "empty-env");
mkdirSync(emptyEnv);
const sourceRoot = path.join(root, "src");
const globalsPath = path.join(sourceRoot, "app", "globals.css");
const normalized = value => value.replaceAll("\\", "/");
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
    name: "offline-pick-fixture-boundaries",
    enforce: "pre",
    resolveId(source) {
      if (source === "next/link" || source === "next/navigation") return "\0fixture:" + source;
      if (source === "server-only" || source.startsWith("next/") || source.startsWith("@supabase/") || source.includes("/lib/supabase/")) {
        throw new Error("The offline pick form fixture reached a server/service import.");
      }
    },
    load(id) {
      if (id === "\0fixture:next/link") return "import {createElement} from 'react';export default function Link({children,href,...props}){return createElement('a',{href,...props},children)}";
      if (id === "\0fixture:next/navigation") return "const router={refresh:()=>{window.fixtureRefreshes=(window.fixtureRefreshes||0)+1;}};export const useRouter=()=>router;export const usePathname=()=>'/picks';";
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
    lib: { entry: fixture, name: "PickFixture", formats: ["iife"], fileName: "fixture", cssFileName: "fixture" }
  }
});
const css = readFileSync(path.join(folder, "fixture.css"), "utf8");
const js = readFileSync(path.join(folder, "fixture.iife.js"), "utf8");
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ offline: true, serviceWorkers: "block" });
const blocked = [], errors = [];
await context.route("**/*", route => { blocked.push(route.request().url()); return route.abort(); });
let checks = 0;
const key = "mound-hounds:pick-draft:v1:fixture-user:1";
try {
  const scene = async (name, width = 390, draft = null) => {
    const page = await context.newPage();
    await page.setViewportSize({ width, height: 900 });
    page.setDefaultTimeout(10_000);
    page.on("pageerror", error => errors.push(error.message));
    await page.setContent('<html><head><meta http-equiv="Content-Security-Policy" content="default-src &apos;none&apos;; script-src &apos;unsafe-inline&apos;; style-src &apos;unsafe-inline&apos;; img-src data: blob:; connect-src &apos;none&apos;"><style>'+css+'</style></head><body><div id="root"></div></body></html>');
    await page.evaluate(({ key, draft }) => {
      window.fixtureCalls = []; window.confirm = () => true;
      // The browser's actual networking stays disabled; only this UI signal is
      // controlled to exercise both connection states with fictional actions.
      window.fixtureOnline = true;
      Object.defineProperty(navigator, "onLine", { configurable: true, get: () => window.fixtureOnline });
      Object.defineProperty(window, "isSecureContext", { configurable: true, value: false });
      const values = new Map(draft ? [[key, JSON.stringify(draft)]] : []);
      Object.defineProperty(window, "localStorage", { configurable: true, value: {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: key => values.delete(key)
      }});
    }, { key, draft });
    await page.addScriptTag({ content: js });
    await page.evaluate(name => {
      if (name === "standings" || name === "standings-unranked") {
        window.showStandingsScene(name === "standings");
      } else {
        window.showPickScene(name);
      }
    }, name);
    await page.locator("main").waitFor();
    return page;
  };
  for (const name of ["saved", "first", "indy", "locked"]) for (const width of [320,390,1280]) {
    const page = await scene(name,width);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth+1), false, `${name} overflows ${width}`);
    checks++; await page.close();
  }
  let page = await scene("saved");
  assert.equal(await page.getByRole("button", { name: "Already saved", exact: true }).isDisabled(), true);
  assert.equal(await page.locator('[name="average_speed"]').isEnabled(), true);
  await page.locator("form").evaluate(form => form.requestSubmit());
  assert.equal(await page.evaluate(() => window.fixtureCalls.length),0); checks++;
  await page.locator('[name="average_speed"]').fill("135.5");
  assert.equal(await page.getByRole("button",{name:"Already saved",exact:true}).isDisabled(),true); checks++;
  await page.locator('[name="driver_group1_id"][value="2"]').locator("..").click();
  assert.equal(await page.getByRole("button",{name:"Save Pick'em Form",exact:true}).isEnabled(),true);
  assert.equal(await page.getByRole("button",{name:"Save",exact:true}).isEnabled(),true); checks++;
  await page.locator('[name="driver_group1_id"][value="1"]').locator("..").click();
  await page.getByRole("button",{name:"Already saved",exact:true}).waitFor();
  assert.equal(await page.locator('[data-mobile-action-dock]').count(),0); checks++;
  await page.locator('[name="average_speed"]').fill("136.501");
  await page.getByRole("button",{name:"Save Pick'em Form",exact:true}).click();
  await page.waitForFunction(() => window.fixtureCalls.length===1);
  assert.equal((await page.evaluate(() => window.fixtureCalls[0])).average_speed,"136.501"); checks++; await page.close();
  page = await scene("stalled");
  await page.clock.install();
  const speed = page.locator('[name="average_speed"]');
  await speed.fill("136.501");
  await page.getByRole("button", { name: "Save Pick'em Form", exact: true }).click();
  await page.waitForFunction(() => window.fixtureCalls.length === 1);
  assert.equal(await speed.isDisabled(), true);
  await page.clock.fastForward(10_000);
  await page.getByText("Save hasn’t been confirmed.", { exact: false }).waitFor();
  assert.equal(await speed.isEnabled(), true);
  assert.equal(await speed.inputValue(), "136.501");
  assert.equal(await page.getByRole("button", { name: "Reload form", exact: true }).isEnabled(), true);
  assert.equal(await page.getByRole("button", { name: "Save Pick'em Form", exact: true }).isEnabled(), true);
  assert.equal(await page.evaluate(() => window.fixtureCalls.length), 1, "Timeout must not retry the save");
  checks++; await page.close();
  page = await scene("first");
  await page.locator('[name="average_speed"]').fill("140.500");
  for (let group=1;group<=6;group++) await page.locator(`[name="driver_group${group}_id"][value="${group*2-1}"]`).locator("..").click();
  await page.getByRole("button",{name:"Save Pick'em Form",exact:true}).click();
  await page.waitForFunction(() => window.fixtureCalls.length===1);
  const call=await page.evaluate(() => window.fixtureCalls[0]);
  assert.equal(call.driver_group6_id,"11"); assert.equal(call.average_speed,"140.500"); checks++; await page.close();
  page = await scene("indy");
  await page.locator('[name="driver_group8_id"][value="16"]').locator("..").click();
  assert.equal(await page.getByRole("button",{name:"Save Pick'em Form",exact:true}).isEnabled(),true);
  await page.locator('[name="driver_group8_id"][value="15"]').locator("..").click();
  assert.equal(await page.getByRole("button",{name:"Already saved",exact:true}).isDisabled(),true); checks++; await page.close();
  const selections=Object.fromEntries(Array.from({length:6},(_,i)=>[i+1,i*2+1]));
  page = await scene("saved",390,{version:1,averageSpeed:"135.5",selections,savedAt:"2027-05-01T13:00:00Z"});
  assert.equal(await page.getByText("Unsaved picks found on this device",{exact:true}).count(),0); checks++; await page.close();
  page = await scene("saved",390,{version:1,averageSpeed:"136.500",selections,savedAt:"2027-05-01T13:00:00Z"});
  await page.getByRole("button",{name:"Continue draft",exact:true}).click();
  assert.equal(await page.getByRole("button",{name:"Save Pick'em Form",exact:true}).isEnabled(),true);
  assert.equal(await page.locator('[name="average_speed"]').inputValue(),"136.500"); checks++; await page.close();
  // Editing an already-loaded form remains possible offline; saving is manual.
  page = await scene("saved");
  await page.locator('[name="average_speed"]').fill("139.125");
  await page.evaluate(() => { window.fixtureOnline = false; window.dispatchEvent(new Event("offline")); });
  await page.getByRole("button", { name: "Reconnect to save", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Reconnect to save", exact: true }).isDisabled(), true);
  await page.locator("form").evaluate(form => form.requestSubmit());
  assert.equal(await page.evaluate(() => window.fixtureCalls.length), 0); checks++;
  await page.locator('[name="average_speed"]').fill("139.250");
  assert.equal((await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key)).averageSpeed, "139.250"); checks++;
  await page.evaluate(() => { window.fixtureOnline = true; window.dispatchEvent(new Event("online")); });
  await page.getByRole("button", { name: "Save Pick'em Form", exact: true }).waitFor();
  assert.equal(await page.locator('[name="average_speed"]').inputValue(), "139.250");
  assert.equal(await page.evaluate(() => window.fixtureCalls.length), 0, "Reconnect must not submit a draft"); checks++;
  await page.getByRole("button", { name: "Save Pick'em Form", exact: true }).click();
  await page.waitForFunction(() => window.fixtureCalls.length === 1); checks++; await page.close();
  page = await scene("saved");
  await page.evaluate(() => window.showPwaScene());
  await page.getByRole("button", { name: "Save changes", exact: true }).waitFor();
  await page.evaluate(() => { window.fixtureOnline = false; window.dispatchEvent(new Event("offline")); });
  await page.waitForFunction(() => document.querySelector('button')?.disabled === true);
  assert.equal(await page.getByRole("button", { name: "Save changes", exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "Confirm changes", exact: true }).isDisabled(), true);
  await page.getByRole("button", { name: "Plain submit", exact: true }).click();
  assert.equal(await page.evaluate(() => window.fixtureCalls.length), 0, "Offline capture must also stop ordinary forms"); checks++; await page.close();
  page = await scene("saved");
  await page.evaluate(() => {
    const media = window.matchMedia.bind(window);
    window.matchMedia = query => query === "(display-mode: standalone)" ? { matches: true, addEventListener() {}, removeEventListener() {} } : media(query);
    window.showPwaScene();
  });
  await page.getByText("You're using the Home Screen app.", { exact: true }).waitFor(); checks++; await page.close();
  page = await scene("saved");
  await page.evaluate(() => {
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { register: async () => { throw new Error("Worker intentionally blocked in fixture"); } } });
    window.showPwaScene();
  });
  await page.getByRole("button", { name: "Save changes", exact: true }).waitFor();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.waitForFunction(() => window.fixtureCalls.length === 1); checks++; await page.close();
  page = await scene("saved");
  await page.evaluate(() => {
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { register: async () => { throw new Error("Worker intentionally blocked in fixture"); } } });
    window.showPwaScene();
  });
  await page.getByRole("button", { name: "Save changes", exact: true }).waitFor();
  await page.evaluate(() => {
    window.fixtureInstallCalls = 0;
    const event = new Event("beforeinstallprompt", { cancelable: true });
    event.prompt = async () => { window.fixtureInstallCalls++; };
    event.userChoice = Promise.resolve({ outcome: "accepted" });
    window.dispatchEvent(event);
  });
  await page.getByRole("button", { name: "Install Mound Hounds", exact: true }).click();
  await page.getByText("App added. Open Mound Hounds from your Home Screen or app launcher.", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.fixtureInstallCalls), 1); checks++; await page.close();
  page = await scene("saved");
  await page.evaluate(() => {
    Object.defineProperty(navigator, "standalone", { configurable: true, value: true });
    window.showPwaScene();
  });
  await page.getByText("You're using the Home Screen app.", { exact: true }).waitFor(); checks++; await page.close();
  page = await scene("saved");
  await page.setViewportSize({ width: 844, height: 390 });
  await page.evaluate(() => {
    for (const [name, value] of Object.entries({ top:44, right:44, bottom:34, left:44 })) document.documentElement.style.setProperty('--safe-area-'+name, value+'px');
    window.showFrameScene();
  });
  // Use a phone-width viewport for fixed navigation, then simulate its safe areas.
  await page.setViewportSize({ width: 700, height: 390 });
  await page.locator('[data-mobile-navigation]').waitFor();
  await page.waitForFunction(() => document.querySelector('[data-mobile-navigation]').getBoundingClientRect().height > 0);
  const geometry = await page.evaluate(() => {
    const nav=document.querySelector('[data-mobile-navigation]').getBoundingClientRect();
    const dock=document.querySelector('[data-mobile-action-dock]').getBoundingClientRect();
    const profile=document.querySelector('a[aria-label="Profile"]').getBoundingClientRect();
    return { navTop:nav.top, dockBottom:dock.bottom, dockLeft:dock.left, dockRight:dock.right, profileWidth:profile.width, profileHeight:profile.height, overflow:document.documentElement.scrollWidth>innerWidth+1 };
  });
  assert.equal(geometry.overflow, false); assert.ok(geometry.dockBottom <= geometry.navTop, JSON.stringify(geometry));
  assert.ok(geometry.dockLeft>=44 && geometry.dockRight<=700-44); assert.ok(geometry.profileWidth>=44 && geometry.profileHeight>=44); checks++; await page.close();
  page = await scene("saved");
  await page.evaluate(() => { window.fixtureRefreshes = 0; window.showRefreshScene(); });
  await page.getByText("Schedule refresh fixture", { exact: true }).waitFor();
  await page.evaluate(() => { window.fixtureOnline = false; window.dispatchEvent(new Event("offline")); window.dispatchEvent(new Event("focus")); });
  assert.equal(await page.evaluate(() => window.fixtureRefreshes), 0, "Offline focus must preserve the open page"); checks++;
  await page.evaluate(() => { window.fixtureOnline = true; window.dispatchEvent(new Event("online")); });
  assert.equal(await page.evaluate(() => window.fixtureRefreshes), 0, "Reconnection must not immediately refresh"); checks++;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForFunction(() => window.fixtureRefreshes === 1); checks++; await page.close();
  page = await scene("saved");
  await page.evaluate(() => window.showPwaScene());
  await page.getByRole("button", { name: "Save changes", exact: true }).waitFor();
  await page.evaluate(() => { window.fixtureOnline = false; window.dispatchEvent(new Event("offline")); });
  await page.waitForFunction(() => document.querySelector('[name="year"]')?.disabled === true);
  assert.equal(await page.locator('[name="year"]').isDisabled(), true);
  assert.equal(await page.locator('#leaderboard-race-select').isDisabled(), true); checks++; await page.close();
  for (const width of [320, 1280]) {
    const page = await scene("standings", width);
    const mobile = width < 768;
    const findTeam = page.getByRole("button", { name: "Find my team", exact: true });
    const team = mobile
      ? page.getByRole("button", { name: /^Zulu Racing, rank 30,/ })
      : page.getByRole("cell", { name: "Zulu Racing", exact: true });
    const pagination = page.getByRole("navigation", { name: "teams pages" });
    const jumpToTeam = async (expectedPage) => {
      await findTeam.focus();
      await page.keyboard.press("Enter");
      await pagination.getByText(`Page ${expectedPage} of 3`, { exact: true }).waitFor();
      const target = await team.elementHandle();
      await page.waitForFunction((element) => {
        const rect = element.getBoundingClientRect();
        return document.activeElement === element && rect.top >= 0 && rect.bottom <= innerHeight;
      }, target);
    };
    assert.equal(await team.count(), 0, "The team starts on a later page");
    await jumpToTeam(2);
    const nameSort = mobile
      ? page.getByRole("button", { name: /^Name / })
      : page.getByRole("button", { name: /^Participant \/ Team / });
    await nameSort.click();
    await jumpToTeam(3);
    await jumpToTeam(3);
    checks++;
    await page.close();
  }
  page = await scene("standings-unranked");
  assert.equal(await page.getByRole("button", { name: "Find my team", exact: true }).count(), 0);
  checks++;
  await page.close();
  assert.deepEqual(errors,[],"Browser fixture exceptions"); assert.deepEqual(blocked,[],"No network requests are permitted");
  console.log(`PASS: ${checks} offline pick-save UI checks; no browser requests permitted.`);
} finally { await browser.close(); }

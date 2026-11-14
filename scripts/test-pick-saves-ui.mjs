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
      if (id === "\0fixture:next/navigation") return "const router={push:(href,options)=>window.fixtureNavigate(href,options),replace:(href)=>{window.fixtureReplaced=href;},refresh:()=>{window.fixtureRefreshes=(window.fixtureRefreshes||0)+1;}};export const useRouter=()=>router;export const usePathname=()=>'/picks';";
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
      } else if (name === "race-picks-published" || name === "race-picks-pending") {
        window.showRacePicksScene(name === "race-picks-published");
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
  for (const [name, groupCount, width] of [["first", 6, 1280], ["indy-first", 8, 320]]) {
    const page = await scene(name, width);
    const dock = page.locator("[data-mobile-action-dock]");
    const controls = width < 768 ? dock : page;
    const save = controls.getByRole("button", { name: width < 768 ? "Save" : "Save Pick'em Form", exact: true });
    const desktopSave = page.getByRole("button", { name: "Save Pick'em Form", exact: true });
    const guidance = label => controls.getByRole("button", { name: label, exact: true });
    const firstDriver = page.getByRole("radio", { name: /Fixture G1 Driver 1/ });
    assert.equal(await save.isDisabled(), true);
    assert.equal(await desktopSave.isDisabled(), true);
    await guidance("Choose a driver in Group 1").focus();
    await page.keyboard.press("Enter");
    assert.equal(await firstDriver.evaluate(el => el === document.activeElement), true);
    for (let group = 1; group <= groupCount; group++) {
      await guidance("Choose a driver in Group " + group).waitFor();
      await page.getByRole("radio", { name: new RegExp("Fixture G" + group + " Driver 1") }).locator("..").click();
    }
    const speed = page.locator('[name="average_speed"]');
    await guidance("Enter an average speed").click();
    assert.equal(await speed.evaluate(el => el === document.activeElement), true);
    for (const invalidSpeed of ["0.5", "300.001", "140.5001"]) {
      await speed.fill(invalidSpeed);
      await guidance("Use 1–300 MPH, up to 3 decimals").waitFor();
      assert.equal(await save.isDisabled(), true);
      assert.equal(await desktopSave.isDisabled(), true);
    }
    await speed.fill("140.501");
    await guidance("Use 1–300 MPH, up to 3 decimals").waitFor({ state: "hidden" });
    assert.equal(await save.isEnabled(), true);
    assert.equal(await desktopSave.isEnabled(), true);
    await save.click();
    await page.waitForFunction(() => window.fixtureCalls.length === 1);
    checks++;
    await page.close();
  }
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
  await page.clock.install({ time: new Date("2027-05-01T13:59:40Z") });
  await page.evaluate(() => window.showRaceStartScene());
  await page.getByText("Race start fixture", { exact: true }).waitFor();
  await page.clock.fastForward(21_000);
  await page.waitForFunction(() => window.fixtureReplaced === "/picks?race_id=1");
  checks++;
  await page.close();

  for (const saved of [true, false]) {
    const page = await scene("saved", 320);
    await page.evaluate(({ saved, key }) => {
      localStorage.setItem(key, "unfinished draft");
      localStorage.setItem(key + "-other-race", "different draft");
      window.showReceiptScene(saved, key);
    }, { saved, key });
    await page.getByRole("heading", { name: saved ? "Picks saved and locked" : "No picks submitted", exact: true }).waitFor();
    await page.waitForFunction(key => localStorage.getItem(key) === null, key);
    assert.equal(await page.evaluate(key => localStorage.getItem(key + "-other-race"), key), "different draft");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    assert.equal(await page.getByRole("listitem").filter({ hasText: "Fixture driver with a long name" }).count(), saved ? 8 : 0);
    assert.equal(await page.getByRole("link", { name: "View Picks by Race" }).getAttribute("href"), "/leaderboard?tab=picks&race_id=1");
    assert.equal(await page.locator('input[name="average_speed"]').count(), 0);
    checks++;
    await page.close();
  }
  page = await scene("saved");
  await page.evaluate(() => window.showPwaScene());
  await page.getByRole("button", { name: "Save changes", exact: true }).waitFor();
  await page.evaluate(() => { window.fixtureOnline = false; window.dispatchEvent(new Event("offline")); });
  await page.waitForFunction(() => document.querySelector('[name="year"]')?.disabled === true);
  assert.equal(await page.locator('[name="year"]').isDisabled(), true);
  assert.equal(await page.locator('#leaderboard-race-select').isDisabled(), true); checks++; await page.close();
  page = await scene("saved");
  await page.evaluate(() => window.showPwaScene());
  await page.waitForFunction(() => typeof window.fixtureNavigate === "function");
  for (const [selector, previous, next, pendingLabel, href] of [
    ['#leaderboard-race-select', "7", "8", "Loading race…", "/leaderboard?tab=picks&race_id=8"],
    ['[name="year"]', "2026", "2025", "Loading season…", "/leaderboard?tab=hall&year=2025"]
  ]) {
    const control = page.locator(selector);
    await control.selectOption(next);
    const status = page.getByText(pendingLabel, { exact: true });
    await status.waitFor();
    assert.equal(await control.isDisabled(), true);
    assert.equal(await control.inputValue(), previous);
    assert.deepEqual(await page.evaluate(() => window.fixtureCalls.at(-1)), { href, options: { scroll: false } });
    await page.evaluate(() => window.finishFixtureNavigation());
    await status.waitFor({ state: "hidden" });
    assert.equal(await control.isEnabled(), true);
    assert.equal(await control.inputValue(), next);
    checks++;
  }
  await page.close();
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
  for (const width of [320, 1280]) {
    for (const resultsPosted of [false, true]) {
      const page = await scene(resultsPosted ? "race-picks-published" : "race-picks-pending", width);
      const entry = (name) => page.locator(width < 768 ? "article" : "tbody tr")
        .filter({ has: page.getByRole("button", { name }) });
      const submitted = entry(/Submitted Racing/);
      const missing = entry(/Missing Racing/);
      assert.equal(await submitted.getByText("Submitted pick", { exact: true }).isVisible(), true);
      assert.equal(await missing.getByText("No pick submitted", { exact: true }).first().isVisible(), true);
      assert.equal(await submitted.getByText("Automatic lowest score", { exact: true }).count(), 0);
      assert.equal(await missing.getByText("Automatic lowest score", { exact: true }).count(), Number(resultsPosted));
      await missing.getByRole("button", { name: /Missing Racing/ }).click();

      const dialog = page.getByRole("dialog", { name: "Missing Racing" });
      assert.equal(await dialog.locator("#picks-detail-description").textContent(), "No pick submitted");
      await dialog.getByRole("cell", { name: "Group 8", exact: true }).waitFor();
      assert.equal(await dialog.getByText("Automatic lowest score", { exact: true }).count(), Number(resultsPosted));
      if (resultsPosted) {
        const score = dialog.getByText("Automatic lowest score", { exact: true }).locator("..");
        assert.match(await score.textContent(), /^16\s*Automatic lowest score$/);
        await dialog.getByText(/lowest score from each driver group/).waitFor();
      }
      checks++;
      await page.close();
    }
  }
  assert.deepEqual(errors,[],"Browser fixture exceptions"); assert.deepEqual(blocked,[],"No network requests are permitted");
  console.log(`PASS: ${checks} offline pick-save UI checks; no browser requests permitted.`);
} finally { await browser.close(); }

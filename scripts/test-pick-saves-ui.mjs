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
      if (source === "server-only" || source.startsWith("next/") || source.startsWith("@supabase/") || source.includes("/lib/supabase/")) {
        throw new Error("The offline pick form fixture reached a server/service import.");
      }
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
      const values = new Map(draft ? [[key, JSON.stringify(draft)]] : []);
      Object.defineProperty(window, "localStorage", { configurable: true, value: {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: key => values.delete(key)
      }});
    }, { key, draft });
    await page.addScriptTag({ content: js });
    await page.evaluate(name => window.showPickScene(name), name);
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
  assert.deepEqual(errors,[],"Browser fixture exceptions"); assert.deepEqual(blocked,[],"No network requests are permitted");
  console.log(`PASS: ${checks} offline pick-save UI checks; no browser requests permitted.`);
} finally { await browser.close(); }

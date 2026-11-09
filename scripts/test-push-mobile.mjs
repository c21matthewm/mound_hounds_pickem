import assert from "node:assert/strict";
import { createECDH } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Browser-engine/gesture coverage, not an OS push-delivery test. No dotenv files,
// live app, real account, real push registration or external networking is used.
const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(path.join(root, "package.json"));
const { build } = await import(pathToFileURL(require.resolve("vite")).href);
const { chromium, webkit, devices } = require("playwright");
const { default: tailwind } = await import(pathToFileURL(require.resolve("@tailwindcss/postcss")).href);
const work = mkdtempSync(path.join(tmpdir(), "mound-push-mobile-"));
const sourceRoot = path.join(root, "src");
const globals = path.join(sourceRoot, "app/globals.css");
const output = path.join(work, "build");
const emptyEnv = path.join(work, "empty-env");
mkdirSync(emptyEnv);
const entry = path.join(work, "fixture.jsx");
writeFileSync(entry, `import {createRoot} from 'react-dom/client';
import {PwaProvider} from ${JSON.stringify(path.join(sourceRoot, "components/pwa-provider.tsx"))};
import {PushNotificationSettings} from ${JSON.stringify(path.join(sourceRoot, "components/push-notification-settings.tsx"))};
import ${JSON.stringify(globals)};
window.showPushFixture=()=>createRoot(document.getElementById('root')).render(<PwaProvider><main className="mx-auto max-w-lg p-4"><label>Unsent draft<input defaultValue="Original draft" /></label><PushNotificationSettings /></main></PwaProvider>);`);
const normalized = value => value.replaceAll("\\", "/");
const origin = "https://push-mobile.fixture.invalid";
const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src &apos;none&apos;; script-src &apos;unsafe-inline&apos;; style-src &apos;unsafe-inline&apos;; img-src data:; connect-src &apos;none&apos;"></head><body><div id="root"></div></body></html>';
const ec = createECDH("prime256v1"); ec.generateKeys();
const publicKey = ec.getPublicKey().toString("base64url");
let checks = 0;
const passed = label => { checks++; console.log("PASS: " + label); };
try {
  await build({
    root, configFile: false, envDir: emptyEnv, envPrefix: [], publicDir: false,
    cacheDir: path.join(work, "cache"), logLevel: "error",
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    resolve: { alias: { "@": sourceRoot, react: path.dirname(require.resolve("react/package.json")), "react-dom": path.dirname(require.resolve("react-dom/package.json")) }, dedupe: ["react", "react-dom"] },
    css: { postcss: { plugins: [tailwind({ base: root })] } },
    plugins: [{
      name: "mobile-push-fixture-boundaries", enforce: "pre",
      resolveId(id) {
        if (id === "next/link") return "\0fixture-link";
        if (id === "server-only" || id.startsWith("@supabase/") || /\/lib\/supabase\//.test(id)) throw Error("Fixture reached a server boundary.");
      },
      load(id) { if (id === "\0fixture-link") return "import {createElement} from 'react';export default function Link({children,href,...props}){return createElement('a',{href,...props},children)}"; },
      transform(code, id) { if (normalized(id) === normalized(globals)) return code.replace('@import "tailwindcss";', `@import "tailwindcss" source(none);\n@source ${JSON.stringify(normalized(sourceRoot))};`); }
    }],
    oxc: { jsx: { runtime: "automatic" } },
    build: { outDir: output, minify: false, lib: { entry, name: "MobilePushFixture", formats: ["iife"], fileName: "fixture", cssFileName: "fixture" } }
  });
  const js = readFileSync(path.join(output, "fixture.iife.js"), "utf8");
  const css = readFileSync(path.join(output, "fixture.css"), "utf8");
  for (const profile of [{ name: "iOS WebKit", browser: webkit, device: "iPhone 13", ios: true }, { name: "Android Chromium", browser: chromium, device: "Pixel 7", ios: false }]) {
    const browser = await profile.browser.launch({ headless: true });
    try {
      for (const scenario of ["browser", "normal", "slow", "denied", "update", "dismissed"]) {
        const context = await browser.newContext({ ...devices[profile.device], serviceWorkers: "block" });
        const unexpected = [], errors = [];
        try {
          await context.route("**/*", route => {
            if (route.request().isNavigationRequest() && route.request().url() === origin + "/") return route.fulfill({ contentType: "text/html", body: html });
            unexpected.push(route.request().method() + " " + new URL(route.request().url()).pathname);
            return route.abort();
          });
          const page = await context.newPage(); page.setDefaultTimeout(12000);
          page.on("pageerror", error => errors.push(error.message));
          await page.goto(origin);
          assert.equal(await page.evaluate(() => window.isSecureContext), true);
          await page.evaluate(({ ios, scenario, publicKey }) => {
            const installed = scenario !== "browser";
            const matchMedia = window.matchMedia.bind(window);
            window.matchMedia = query => query === "(display-mode: standalone)" ? { matches: installed && !ios, addEventListener() {}, removeEventListener() {} } : matchMedia(query);
            Object.defineProperty(navigator, "standalone", { configurable: true, value: installed && ios });
            window.mobilePush = { calls: [], enabled: false, sub: null, trustedTap: false, gesture: null, unexpected: [] };
            document.addEventListener("click", event => { window.mobilePush.trustedTap = event.isTrusted; setTimeout(() => { window.mobilePush.trustedTap = false; }, 0); }, true);
            const state = window.mobilePush;
            const sub = { endpoint: ios ? "https://web.push.apple.com/fixture" : "https://fcm.googleapis.com/fcm/send/fixture", toJSON: () => ({ endpoint: sub.endpoint, keys: { p256dh: publicKey, auth: "AAAAAAAAAAAAAAAAAAAAAA" } }), unsubscribe: async () => { state.calls.push("unsubscribe"); state.sub = null; return true; } };
            const registration = { waiting: scenario === "update" ? {} : null, active: { postMessage: (_message, ports) => setTimeout(() => ports[0].postMessage({ push: scenario !== "update" }), scenario === "slow" ? 2500 : 0) }, pushManager: {
              getSubscription: async () => state.sub,
              subscribe: async options => {
                if (options.userVisibleOnly !== true || !(options.applicationServerKey instanceof Uint8Array) || options.applicationServerKey.length !== 65 || options.applicationServerKey[0] !== 4) throw Error("Invalid browser subscription options.");
                state.calls.push("subscribe"); state.sub = sub; return sub;
              }
            } };
            Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { ready: Promise.resolve(registration), register: async () => { state.calls.push("register"); return registration; }, getRegistration: async () => registration } });
            window.PushManager = function () {};
            window.Notification = { permission: scenario === "denied" ? "denied" : "default", requestPermission: () => {
              state.calls.push("permission"); state.gesture = { trusted: state.trustedTap, active: navigator.userActivation?.isActive ?? null };
              window.Notification.permission = scenario === "dismissed" ? "default" : "granted";
              return Promise.resolve(window.Notification.permission);
            } };
            window.fetch = async (url, options = {}) => {
              if (!["/api/push/subscription", "/api/push/test"].includes(String(url))) { state.unexpected.push(String(url)); throw Error("Unexpected fixture API request."); }
              const input = options.body ? JSON.parse(options.body) : {};
              let data = { configured: true, publicKey, enabled: state.enabled, pickDeliveryEnabled: true };
              if (options.method === "DELETE") { state.calls.push("DELETE"); state.enabled = false; data = { enabled: false }; }
              else if (input.action === "status") data = { enabled: state.enabled };
              else if (options.method === "POST") { state.calls.push(url.endsWith("/test") ? "test" : "enroll"); state.enabled = true; data = { enabled: true, sent: true }; }
              return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
            };
          }, { ios: profile.ios, scenario, publicKey });
          await page.addStyleTag({ content: css }); await page.addScriptTag({ content: js });
          await page.evaluate(() => window.showPushFixture());
          const prefix = profile.name + " / " + scenario;
          const calls = () => page.evaluate(() => window.mobilePush.calls.filter(action => action !== "register"));
          if (scenario === "browser") {
            await page.getByRole("link", { name: "How to install" }).waitFor();
            passed(prefix + ": browser tab directs to Home Screen installation");
            assert.deepEqual(await calls(), []);
          } else if (scenario === "update") {
            await page.getByText("An app update is ready.", { exact: false }).waitFor();
            assert.equal(await page.getByRole("button", { name: "Enable notifications", exact: true }).count(), 0);
            assert.deepEqual(await calls(), []);
            passed(prefix + ": old-worker guidance precedes permission");
          } else {
            const enable = page.getByRole("button", { name: "Enable notifications", exact: true });
            await enable.waitFor(); await page.waitForFunction(() => [...document.querySelectorAll("button")].some(b => b.textContent === "Enable notifications" && !b.disabled));
            assert.deepEqual(await calls(), []);
            passed(prefix + ": real standalone detector shows controls without asking permission");
            await page.getByLabel("Unsent draft").fill("Keep this unsent text");
            await enable.tap();
            if (scenario === "denied" || scenario === "dismissed") {
              await page.getByText(scenario === "denied" ? "Notifications are blocked." : "Notifications are still off.", { exact: false }).waitFor();
              assert.deepEqual(await calls(), scenario === "denied" ? [] : ["permission"]);
              passed(prefix + ": no enrollment without permission");
            } else {
              await page.getByRole("button", { name: "Send test notification" }).waitFor();
              assert.deepEqual(await calls(), ["permission", "subscribe", "enroll"]);
              const gesture = await page.evaluate(() => window.mobilePush.gesture);
              assert.equal(gesture.trusted, true); assert.notEqual(gesture.active, false);
              assert.equal(await page.getByText(/Close Mound Hounds|reopen/i).count(), 0);
              passed(prefix + ": tap, Allow and valid P256 subscription complete without restart");
              await page.getByRole("button", { name: "Send test notification" }).tap();
              await page.getByText("Test sent. Check your notifications.", { exact: true }).waitFor();
              await page.getByRole("button", { name: "Disable notifications" }).tap(); await enable.waitFor();
              assert.deepEqual((await calls()).slice(-3), ["test", "DELETE", "unsubscribe"]);
              passed(prefix + ": test and disable controls work");
            }
            assert.equal(await page.getByLabel("Unsent draft").inputValue(), "Keep this unsent text");
            assert.equal(page.url(), origin + "/");
            await page.setViewportSize({ width: 320, height: 700 });
          }
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
          assert.deepEqual(unexpected, []); assert.deepEqual(errors, []);
          assert.deepEqual(await page.evaluate(() => window.mobilePush.unexpected), []);
          passed(prefix + ": fits phone width, keeps page state and sends no external requests");
        } finally { await context.close(); }
      }
    } finally { await browser.close(); }
  }
  console.log(`PASS: ${checks} mobile engine checks. Permission, push services and API replies are fixtures; physical iOS/Android notification delivery is not simulated or certified.`);
} finally { rmSync(work, { recursive: true, force: true }); }

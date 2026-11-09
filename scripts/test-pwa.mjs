import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// A local-only production-build verification. Never read dotenv files, sign in,
// or use real league services. Fixtures and all browser storage are temporary.
const root = fileURLToPath(new URL("../", import.meta.url));
assert.ok(fs.readFileSync(path.join(root,"public/sw.js"),"utf8").includes('addEventListener("push"'));
assert.ok(fs.readFileSync(path.join(root,"public/sw.js"),"utf8").includes('addEventListener("notificationclick"'));
if (process.versions.node.split(".")[0] !== "24") {
  throw new Error("Run this verification with Node 24: ./scripts/with-node.sh node scripts/test-pwa.mjs");
}
if (process.argv.length > 2) throw new Error("This runner accepts no remote URL or database arguments.");

const work = fs.mkdtempSync(path.join(os.tmpdir(), "mound-pwa-"));
const app = path.join(work, "app");
const guardFile = path.join(work, "loopback-only.cjs");
const blockedFile = path.join(work, "blocked-node-requests.log");
const children = new Set();
const issues = [];
const proxyDenials = [];
const sockets = new Set();
let browser;
let fixture;
let proxy;
let reservation;
let checks = 0;
const ownedPrefix = "mound-hounds-pwa-";
const oldCache = `${ownedPrefix}old-verification-fixture`;
const unrelatedCache = "unrelated-pwa-verification-fixture";
const expectedAssets = ["/icons/icon-192.png", "/offline.html"];
const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

const check = (label, verification) => {
  verification();
  checks++;
  console.log(`PASS: ${label}`);
};
const listen = server => new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => resolve(server.address().port));
});
const closeServer = server => new Promise(resolve => {
  if (!server?.listening) return resolve();
  server.close(resolve);
  server.closeAllConnections();
});
const run = (file, args, env) => new Promise((resolve, reject) => {
  const child = spawn(file, args, { cwd: app, env, stdio: "inherit" });
  children.add(child);
  child.once("error", reject);
  child.once("exit", (code, signal) => {
    children.delete(child);
    if (code === 0) resolve();
    else reject(new Error(`${path.basename(file)} failed (${signal ?? code}).`));
  });
});
const stop = async child => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(resolve => child.once("exit", resolve));
  child.kill("SIGTERM");
  let timer;
  await Promise.race([exited, new Promise(resolve => { timer = setTimeout(resolve, 4000); })]);
  clearTimeout(timer);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await exited;
  }
};

fs.writeFileSync(guardFile, String.raw`
const fs = require("node:fs");
const allowed = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
function host(value, transport) {
  const name = String(value || "localhost").toLowerCase();
  if (allowed.has(name)) return;
  fs.appendFileSync(process.env.PWA_BLOCKED_LOG, transport + " external destination blocked\n");
  throw new Error("PWA verification blocked non-loopback networking");
}
function destination(value, transport) {
  if (typeof value === "string" || value instanceof URL) host(new URL(value).hostname, transport);
  else if (!(value?.path && !value.host && !value.hostname && !value.port)) host(value?.hostname || value?.host || value?.servername, transport);
}
const originalFetch = globalThis.fetch;
globalThis.fetch = function (input, ...args) {
  destination(typeof input === "string" || input instanceof URL ? input : input.url, "fetch");
  return originalFetch.call(this, input, ...args);
};
for (const name of ["http", "https"]) {
  const module = require("node:" + name);
  for (const method of ["get", "request"]) {
    const original = module[method];
    module[method] = function (...args) {
      destination(args[0], name);
      if ((typeof args[0] === "string" || args[0] instanceof URL) && args[1] && typeof args[1] === "object" && (args[1].host || args[1].hostname)) destination(args[1], name);
      return original.apply(this, args);
    };
  }
}
const net = require("node:net");
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  if (first && typeof first === "object") { if (!first.path) host(first.host || first.hostname, "socket"); }
  else if (typeof first === "number" || typeof first === "string" && /^\d+$/.test(first)) host(typeof args[1] === "string" ? args[1] : null, "socket");
  return connect.apply(this, args);
};
const tls = require("node:tls");
const tlsConnect = tls.connect;
tls.connect = function (...args) {
  if (args[0] && typeof args[0] === "object") { if (!args[0].path) host(args[0].host || args[0].hostname || args[0].servername, "tls"); }
  else if (typeof args[1] === "string") host(args[1], "tls");
  return tlsConnect.apply(this, args);
};
`);

try {
  fs.mkdirSync(app);
  const files = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: root, encoding: "utf8"
  });
  assert.equal(files.status, 0, "Could not enumerate the local source files");
  for (const relative of files.stdout.split("\0").filter(Boolean)) {
    if (relative.split(/[\\/]/).some(part => part.startsWith(".env"))) continue;
    const source = path.join(root, relative);
    if (!fs.existsSync(source)) continue;
    assert.equal(fs.lstatSync(source).isSymbolicLink(), false, `Source symlinks are not copied: ${relative}`);
    const target = path.join(app, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
  assert.ok(fs.existsSync(path.join(root, "node_modules/next/dist/bin/next")), "Install project dependencies before running PWA verification");
  console.log("Copying installed dependencies into a temporary app without dotenv files.");
  fs.cpSync(path.join(root, "node_modules"), path.join(app, "node_modules"), {
    recursive: true, verbatimSymlinks: true, mode: fs.constants.COPYFILE_FICLONE
  });

  // This endpoint exists only in the discarded copy. Its counter is in memory;
  // no authentication, Supabase, filesystem persistence, or real records exist.
  const fixtureRoute = path.join(app, "src/app/api/pwa-fixture/route.ts");
  fs.mkdirSync(path.dirname(fixtureRoute), { recursive: true });
  fs.writeFileSync(fixtureRoute, `export const dynamic = "force-dynamic";\nlet writes = 0;\nexport async function GET() { return Response.json({ writes }, { headers: { "Cache-Control": "no-store" } }); }\nexport async function POST() { writes++; return Response.json({ writes }, { headers: { "Cache-Control": "no-store" } }); }\n`);

  fixture = http.createServer((request, response) => {
    const url = new URL(request.url, "http://fixture.invalid");
    if (request.method === "GET" && url.pathname === "/rest/v1/league_seasons" && url.searchParams.get("status") === "eq.active") {
      response.writeHead(200, { "Content-Type": "application/json", "Content-Range": "*/0", "Cache-Control": "no-store" });
      response.end("[]");
      return;
    }
    issues.push(`Unexpected fictional Supabase request: ${request.method} ${url.pathname}`);
    response.writeHead(501, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ message: "Unexpected fixture request" }));
  });
  const fixturePort = await listen(fixture);
  reservation = http.createServer();
  const port = await listen(reservation);
  const origin = `http://127.0.0.1:${port}`;
  const fixtureOrigin = `http://127.0.0.1:${fixturePort}`;
  const permittedOrigins = new Set([origin, fixtureOrigin]);
  const env = Object.fromEntries(["HOME", "TMPDIR", "LANG", "LC_ALL", "TZ"].filter(key => process.env[key]).map(key => [key, process.env[key]]));
  Object.assign(env, {
    PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ""}`,
    NODE_ENV: "production",
    NEXT_PUBLIC_SUPABASE_URL: fixtureOrigin,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "fictional-pwa-anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "fictional-pwa-service-role-key",
    NEXT_PUBLIC_SITE_URL: origin,
    PICK_EMAILS_ENABLED: "false",
    NEXT_TELEMETRY_DISABLED: "1",
    NODE_OPTIONS: `--require=${guardFile}`,
    PWA_BLOCKED_LOG: blockedFile
  });
  const next = path.join(app, "node_modules/next/dist/bin/next");
  console.log("Building the production app against loopback-only fictional services.");
  await run(process.execPath, [next, "build"], env);
  if (fs.existsSync(blockedFile)) assert.equal(fs.readFileSync(blockedFile, "utf8"), "", "Build attempted external networking");
  await closeServer(reservation);
  const server = spawn(process.execPath, [next, "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: app, env, stdio: "inherit"
  });
  children.add(server);
  server.once("error", error => issues.push(`Local app failed to start: ${error.message}`));

  const localFetch = async (pathname, options = {}) => {
    const url = new URL(pathname, origin);
    assert.equal(url.origin, origin, "HTTP verification must stay on the temporary app");
    return fetch(url, { ...options, redirect: "manual", signal: AbortSignal.timeout(10_000) });
  };
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (server.exitCode !== null) throw new Error("The temporary app stopped before becoming ready");
    try {
      const response = await localFetch("/login");
      const html = await response.text();
      if (response.status === 200 && html.includes("Sign in")) { ready = true; break; }
    } catch { /* A local server may still be starting. */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(ready, "Temporary production login did not become ready");

  const manifestResponse = await localFetch("/manifest.webmanifest");
  assert.equal(manifestResponse.status, 200);
  assert.match(manifestResponse.headers.get("content-type") ?? "", /application\/manifest\+json/);
  assert.equal(manifestResponse.headers.get("set-cookie"), null);
  const manifest = await manifestResponse.json();
  check("public manifest has standalone identity and a query-free root launch", () => {
    assert.equal(manifest.display, "standalone");
    assert.equal(manifest.id, "/");
    assert.equal(manifest.scope, "/");
    assert.equal(manifest.start_url, "/");
    assert.equal(manifest.prefer_related_applications, false);
  });
  for (const icon of manifest.icons) {
    const url = new URL(icon.src, origin);
    assert.equal(url.origin, origin, "Manifest icons cannot target another origin");
    assert.equal(url.search, "");
    const response = await localFetch(url.pathname);
    const bytes = Buffer.from(await response.arrayBuffer());
    check(`manifest PNG ${icon.sizes} (${icon.purpose}) is served at its declared dimensions`, () => {
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") ?? "", /image\/png/);
      assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
      const [width, height] = icon.sizes.split("x").map(Number);
      assert.equal(bytes.readUInt32BE(16), width);
      assert.equal(bytes.readUInt32BE(20), height);
    });
  }
  const appleResponse = await localFetch("/icons/apple-touch-icon.png");
  const apple = Buffer.from(await appleResponse.arrayBuffer());
  check("Apple touch icon is a real public 180px PNG", () => {
    assert.equal(appleResponse.status, 200);
    assert.equal(apple.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(apple.readUInt32BE(16), 180);
    assert.equal(apple.readUInt32BE(20), 180);
  });
  const workerResponse = await localFetch("/sw.js");
  check("root worker has JavaScript MIME, uncached updates, and root scope permission", () => {
    assert.equal(workerResponse.status, 200);
    assert.match(workerResponse.headers.get("content-type") ?? "", /(?:application|text)\/javascript/);
    assert.match(workerResponse.headers.get("cache-control") ?? "", /no-store/);
    assert.equal(workerResponse.headers.get("service-worker-allowed"), "/");
    assert.equal(workerResponse.headers.get("set-cookie"), null);
  });
  await workerResponse.body?.cancel();

  // Proxy all Chromium traffic, including service-worker updates and redirects.
  // Only the two in-memory loopback origins are ever forwarded; CONNECT is denied.
  proxy = http.createServer((request, response) => {
    let target;
    try { target = new URL(request.url); } catch { response.writeHead(400).end(); return; }
    if (target.protocol !== "http:" || !loopbackHosts.has(target.hostname) || !permittedOrigins.has(target.origin) || target.username || target.password) {
      proxyDenials.push("Non-loopback browser proxy destination blocked");
      response.writeHead(403).end();
      return;
    }
    const headers = { ...request.headers };
    delete headers["proxy-connection"];
    const forwarded = http.request(target, { method: request.method, headers }, upstream => {
      response.writeHead(upstream.statusCode ?? 502, upstream.headers);
      upstream.pipe(response);
    });
    forwarded.once("error", () => { if (!response.headersSent) response.writeHead(502); response.end(); });
    request.pipe(forwarded);
  });
  proxy.on("connect", (_request, socket) => {
    proxyDenials.push("HTTPS browser proxy destination blocked");
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
  });
  proxy.on("connection", socket => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  const proxyPort = await listen(proxy);
  const requireFromRepo = createRequire(path.join(root, "package.json"));
  const { chromium, devices } = requireFromRepo("playwright");
  browser = await chromium.launch({ headless: true, proxy: { server: `http://127.0.0.1:${proxyPort}` }, args: ["--disable-quic"] });
  const context = await browser.newContext({ ...devices["Pixel 7"], serviceWorkers: "allow" });
  context.setDefaultTimeout(20_000);
  context.on("page", page => page.on("pageerror", error => issues.push(`Browser exception: ${error.message}`)));
  await context.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const local = url.protocol === "http:" && loopbackHosts.has(url.hostname) && permittedOrigins.has(url.origin);
    const safeWrite = url.origin === origin && url.pathname === "/api/pwa-fixture" && request.method() === "POST";
    if (!local || !["GET", "HEAD"].includes(request.method()) && !safeWrite) {
      issues.push(`Unexpected browser request blocked: ${request.method()} ${url.pathname}`);
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
  await context.routeWebSocket("**/*", async socket => {
    issues.push("Unexpected browser WebSocket blocked");
    await socket.close();
  });

  const page = await context.newPage();
  await page.goto(`${origin}/offline.html`);
  await page.evaluate(async ({ oldCache, unrelatedCache }) => {
    await (await caches.open(oldCache)).put("/old-pwa-fixture", new Response("old app fixture"));
    await (await caches.open(unrelatedCache)).put("/unrelated-fixture", new Response("leave this fixture alone"));
  }, { oldCache, unrelatedCache });
  const workerPromise = context.waitForEvent("serviceworker");
  await Promise.all([page.goto(`${origin}/login`), workerPromise]);
  await page.getByRole("heading", { name: "Sign in", exact: true }).waitFor();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForFunction(() => navigator.serviceWorker.controller?.state === "activated");
  const registration = await page.evaluate(async () => {
    const result = await navigator.serviceWorker.getRegistration();
    return { scope: result.scope, script: result.active.scriptURL, state: result.active.state };
  });
  check("production registration activates the real root-scoped service worker", () => {
    assert.equal(registration.scope, `${origin}/`);
    assert.equal(registration.script, `${origin}/sw.js`);
    assert.equal(registration.state, "activated");
  });
  const viewport = await page.locator('meta[name="viewport"]').getAttribute("content");
  check("mobile metadata allows zoom and covers display safe areas", () => {
    assert.match(viewport, /width=device-width/);
    assert.match(viewport, /viewport-fit=cover/);
    assert.doesNotMatch(viewport, /user-scalable=no|maximum-scale=1(?:\D|$)/);
  });
  assert.equal(await page.locator('meta[name="mobile-web-app-capable"]').getAttribute("content"), "yes");
  assert.equal(await page.locator('meta[name="apple-mobile-web-app-capable"]').getAttribute("content"), "yes");
  assert.equal(await page.locator('meta[name="apple-mobile-web-app-title"]').getAttribute("content"), "Mound Hounds");
  assert.equal(await page.locator('link[rel="apple-touch-icon"]').getAttribute("href"), "/icons/apple-touch-icon.png");

  const assertCache = async label => {
    const cached = await page.evaluate(async ({ ownedPrefix, oldCache, unrelatedCache }) => {
      const names = await caches.keys();
      const owned = names.filter(name => name.startsWith(ownedPrefix));
      const entries = {};
      for (const name of owned) entries[name] = (await (await caches.open(name)).keys()).map(request => {
        const url = new URL(request.url);
        return { origin: url.origin, path: url.pathname, search: url.search };
      });
      return { owned, entries, oldExists: names.includes(oldCache), unrelatedExists: names.includes(unrelatedCache) };
    }, { ownedPrefix, oldCache, unrelatedCache });
    check(label, () => {
      assert.equal(cached.owned.length, 1);
      assert.equal(cached.oldExists, false);
      assert.equal(cached.unrelatedExists, true);
      const entries = cached.entries[cached.owned[0]];
      assert.deepEqual(entries.map(entry => entry.path).sort(), expectedAssets);
      assert.ok(entries.every(entry => entry.origin === origin && entry.search === ""));
    });
  };
  await assertCache("activation removes only older app caches and caches exactly two public assets");
  for (const pathname of ["/signup", "/forgot-password", "/install", "/dashboard", "/profile", "/admin"]) {
    await page.goto(`${origin}${pathname}`);
    if (["/dashboard", "/profile", "/admin"].includes(pathname)) {
      await page.waitForURL(url => url.pathname === "/login");
      await page.getByRole("heading", { name: "Sign in", exact: true }).waitFor();
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `Mobile page overflow: ${pathname}`);
  }
  await assertCache("auth screens and protected redirects never enter Cache Storage");

  const fixtureRequest = (method = "GET") => page.evaluate(async method => {
    const response = await fetch("/api/pwa-fixture", { method, cache: "no-store" });
    if (!response.ok) throw new Error("Fictional API request failed");
    return response.json();
  }, method);
  assert.equal((await fixtureRequest()).writes, 0);
  assert.equal((await fixtureRequest("POST")).writes, 1);
  checks++;
  console.log("PASS: one explicit online POST reaches only the temporary in-memory fixture");

  await context.setOffline(true);
  const offlinePost = await page.evaluate(async () => {
    try { await fetch("/api/pwa-fixture", { method: "POST" }); return "unexpected success"; }
    catch { return "network rejected"; }
  });
  assert.equal(offlinePost, "network rejected");
  const freshPage = await context.newPage();
  const offlineResponse = await freshPage.goto(`${origin}/dashboard`);
  await freshPage.getByRole("heading", { name: "You're offline", exact: true }).waitFor();
  check("a fresh offline navigation receives only the cached public recovery page with status 503", () => {
    assert.equal(offlineResponse.status(), 503);
    assert.match(offlineResponse.headers()["cache-control"] ?? "", /no-store/);
  });
  assert.equal(await freshPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  assert.equal(await freshPage.locator("img").evaluate(image => image.complete && image.naturalWidth === 192), true);
  const apiOffline = await freshPage.evaluate(async () => {
    try { await fetch("/api/pwa-fixture"); return "unexpected response"; }
    catch { return "network rejected"; }
  });
  assert.equal(apiOffline, "network rejected", "Offline API GETs must not receive cached league data or fallback HTML");
  const hasBackgroundSync = await freshPage.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    if (!("sync" in registration)) return null;
    try { return (await registration.sync.getTags()).length; }
    catch { return null; } // Some private/automation contexts disable Background Sync.
  });
  if (hasBackgroundSync !== null) assert.equal(hasBackgroundSync, 0);
  checks++;
  console.log("PASS: offline writes fail without a submission queue and API reads remain network-only");

  await context.setOffline(false);
  await freshPage.getByRole("status").filter({ hasText: "Connection available" }).waitFor();
  assert.equal(await freshPage.getByRole("heading", { name: "You're offline", exact: true }).isVisible(), true, "Reconnection must not force a reload");
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.equal((await fixtureRequest()).writes, 1, "Reconnection must never replay the failed POST");
  await freshPage.getByRole("button", { name: "Try again", exact: true }).click();
  await freshPage.getByRole("heading", { name: "Sign in", exact: true }).waitFor();
  assert.equal(new URL(freshPage.url()).pathname, "/login");
  assert.equal((await fixtureRequest()).writes, 1);
  assert.equal((await fixtureRequest("POST")).writes, 2);
  checks++;
  console.log("PASS: reconnect preserves manual retry and a second write requires explicit action");
  await assertCache("online recovery and fixture API calls leave the same bounded public cache");
  assert.deepEqual(issues, [], "Unexpected network or browser activity");
  if (fs.existsSync(blockedFile)) assert.equal(fs.readFileSync(blockedFile, "utf8"), "", "App attempted non-loopback networking");
  console.log(`PASS: ${checks} local PWA checks; no real accounts, databases, app credentials, or external application requests.`);
  if (proxyDenials.length) console.log(`Browser proxy safely rejected ${proxyDenials.length} non-loopback connection attempt(s).`);
} catch (error) {
  console.error(`PWA verification failed: ${error instanceof Error ? error.message : "Unexpected local verification error"}`);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  for (const child of children) await stop(child);
  for (const socket of sockets) socket.destroy();
  await closeServer(proxy);
  await closeServer(fixture);
  await closeServer(reservation);
  fs.rmSync(work, { recursive: true, force: true });
  console.log("Temporary PWA app, fixtures, and browser storage removed.");
}

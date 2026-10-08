import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { probeLogin, selectSmokeTarget, smokeTarget } from "../../scripts/lib/smoke-readiness";

const LOGIN = '<title>Mound Hounds Pick&#x27;em</title><h1 class="heading">Sign in</h1><input name="password"><a href="/signup">Join</a>';
const PREVIEW = "https://moundhoundspickem-fixture-c21matthewms-projects.vercel.app";
const servers: Server[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
});

describe("public production smoke selection", () => {
  it("skips previews, failed deployments, and incomplete events without selecting any app URL", () => {
    expect(selectSmokeTarget("deployment_status", { deployment: { production_environment: false }, deployment_status: { state: "success" } }, PREVIEW)).toBeNull();
    expect(selectSmokeTarget("deployment_status", { deployment: { production_environment: true }, deployment_status: { state: "failure" } })).toBeNull();
    expect(selectSmokeTarget("deployment_status", {})).toBeNull();
  });
  it("selects the public alias for successful production and permits a public manual override", () => {
    const production = { deployment: { production_environment: true }, deployment_status: { state: "success" } };
    expect(selectSmokeTarget("deployment_status", production)?.origin).toBe("https://moundhoundspickem.app");
    expect(selectSmokeTarget("deployment_status", production, "https://public.example")?.origin).toBe("https://public.example");
    expect(selectSmokeTarget("workflow_dispatch", { inputs: { base_url: "http://127.0.0.1:3007" } }, "https://public.example")?.origin).toBe("http://127.0.0.1:3007");
    expect(() => selectSmokeTarget("push", production)).toThrow("successful production");
  });
  it("normalizes the exact legacy production alias for selection and direct smoke commands", () => {
    const legacy = "https://moundhoundspickem.vercel.app";
    const canonical = "https://moundhoundspickem.app";
    expect(smokeTarget(legacy).origin).toBe(canonical);
    expect(selectSmokeTarget("deployment_status", { deployment: { environment: "Production" }, deployment_status: { state: "success" } }, legacy)?.origin).toBe(canonical);
    expect(selectSmokeTarget("workflow_dispatch", { inputs: { base_url: legacy } })?.origin).toBe(canonical);
    expect(() => smokeTarget(legacy + "/login")).toThrow("without credentials");
    expect(() => smokeTarget("https://user:fictional-secret@moundhoundspickem.vercel.app")).toThrow("without credentials");
  });
  it("handles Vercel's observed Production label with a false boolean, while rejecting Preview", () => {
    expect(selectSmokeTarget("deployment_status", { deployment: { environment: "Production", production_environment: false }, deployment_status: { state: "success" } })?.origin).toBe("https://moundhoundspickem.app");
    expect(selectSmokeTarget("deployment_status", { deployment: { environment: "Preview", production_environment: true }, deployment_status: { state: "success" } })).toBeNull();
    expect(selectSmokeTarget("deployment_status", { deployment: { environment: "Staging", production_environment: false }, deployment_status: { state: "success" } })).toBeNull();
  });
  it("rejects protected preview URLs and never exposes credentials in invalid URL diagnostics", () => {
    expect(() => smokeTarget(PREVIEW)).toThrow("Protected Vercel previews are excluded");
    for (const value of ["https://user:secret@public.example", "https://public.example?token=secret", "https://public.example/login", "ftp://example.com", "http://example.com", "https://*.example.com"]) {
      expect(() => smokeTarget(value)).toThrow();
      try { smokeTarget(value); } catch (error) { expect(String(error)).not.toContain(value); }
    }
  });
});

describe("anonymous login readiness", () => {
  it("requires the application's login form, rather than arbitrary success or a provider screen", async () => {
    const target = smokeTarget("https://public.example");
    expect((await probeLogin(target, vi.fn(async () => new Response(LOGIN)))).ready).toBe(true);
    expect((await probeLogin(target, vi.fn(async () => new Response('<title>Vercel</title><h1>Sign in</h1>')))).ready).toBe(false);
    expect((await probeLogin(target, vi.fn(async () => new Response("a".repeat(512 * 1024 + 1))))).reason).toContain("response/time limit");
  });
  it("follows only same-origin redirects with bounded GET requests and no authorization headers", async () => {
    const target = smokeTarget("https://public.example");
    const fetchRequest = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 307, headers: { location: "/login?ready=1" } })).mockResolvedValueOnce(new Response(LOGIN));
    expect((await probeLogin(target, fetchRequest)).ready).toBe(true);
    expect(fetchRequest).toHaveBeenCalledTimes(2);
    for (const [url, options] of fetchRequest.mock.calls) {
      expect(new URL(String(url)).origin).toBe(target.origin);
      expect(options).toEqual(expect.objectContaining({ method: "GET", redirect: "manual", headers: { accept: "text/html" } }));
    }
  });
  it("refuses provider redirects and keeps sensitive transport messages out of diagnostics", async () => {
    const target = smokeTarget("https://public.example");
    const fetchRequest = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://provider.example/?token=fictional-secret" } }));
    const result = await probeLogin(target, fetchRequest);
    expect(result.fatal).toContain("outside the public application");
    expect(JSON.stringify(result)).not.toContain("fictional-secret");
    expect(fetchRequest).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(await probeLogin(target, vi.fn(async () => { throw new Error("fictional-secret"); })))).not.toContain("fictional-secret");
  });
  it("detects denied access and bounds redirect loops", async () => {
    const target = smokeTarget("https://public.example");
    expect((await probeLogin(target, vi.fn(async () => new Response(null, { status: 403 })))).fatal).toContain("never bypass");
    const loop = vi.fn(async () => new Response(null, { status: 307, headers: { location: "/login" } }));
    expect((await probeLogin(target, loop)).reason).toContain("redirect limit");
    expect(loop).toHaveBeenCalledTimes(5);
  });
  it("makes a real anonymous GET to a loopback fixture without authentication or cookies", async () => {
    const seen: string[] = [];
    const server = createServer((req, res) => {
      seen.push(`${req.method} ${req.url}`);
      expect(req.headers.authorization).toBeUndefined();
      expect(req.headers.cookie).toBeUndefined();
      res.writeHead(200, { "Content-Type": "text/html" }); res.end(LOGIN);
    });
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Fixture did not bind");
    expect((await probeLogin(smokeTarget(`http://127.0.0.1:${address.port}`))).ready).toBe(true);
    expect(seen).toEqual(["GET /login"]);
  });
});

describe("standalone readiness diagnostics", () => {
  it("publishes actionable CI annotations without leaking invalid origin credentials", () => {
    const entry = pathToFileURL(path.resolve("scripts/smoke-readiness.mjs")).href;
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval",
      `globalThis.fetch = async () => { throw new Error("Network is disabled in this regression"); }; await import(${JSON.stringify(entry)});`
    ], {
      encoding: "utf8", timeout: 10_000,
      env: { NODE_ENV: "test", GITHUB_ACTIONS: "true", PW_BASE_URL: "https://user:fictional-secret@public.example" }
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("::error title=Anonymous smoke readiness::PW_BASE_URL must be an HTTPS application origin");
    expect(result.stderr).not.toContain("fictional-secret");
  });
});

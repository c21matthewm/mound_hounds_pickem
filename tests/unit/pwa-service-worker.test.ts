import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const ORIGIN = "https://pwa-fixture.example";
const CACHE_PREFIX = "mound-hounds-pwa-";
const PUBLIC_PATHS = ["/offline.html", "/icons/icon-192.png"];
const OFFLINE_HTML = "<main><h1>You are offline</h1><p>Reconnect to use league features.</p></main>";

type WorkerEvent = {
  request?: Request;
  data?: {json:()=>unknown};
  notification?: {data?:{url?:string};close:()=>void};
  respondWith: (response: Response | PromiseLike<Response>) => void;
  waitUntil: (work: PromiseLike<unknown>) => void;
};
type WorkerListener = (event: WorkerEvent) => unknown;
type BrowserRequestOptions = Omit<RequestInit, "mode"> & {
  mode?: RequestMode;
  destination?: RequestDestination;
};

function browserRequest(path: string, options: BrowserRequestOptions = {}): Request {
  const { destination, mode = "cors", ...init } = options;
  const request = new Request(new URL(path, ORIGIN), {
    ...init,
    // Undici does not construct browser navigation requests; the event carries
    // their real browser-visible mode and destination instead.
    mode: mode === "navigate" ? "same-origin" : mode
  });
  Object.defineProperty(request, "mode", { value: mode });
  Object.defineProperty(request, "destination", { value: destination ?? (mode === "navigate" ? "document" : "") });
  return request;
}

function publicResponse(request: Request): Response {
  const pathname = new URL(request.url).pathname;
  const response = new Response(pathname === "/offline.html" ? OFFLINE_HTML : `public asset ${pathname}`, {
    headers: { "Content-Type": pathname.endsWith(".html") ? "text/html; charset=utf-8" : "image/png" }
  });
  Object.defineProperty(response, "type", { value: "basic" });
  Object.defineProperty(response, "url", { value: request.url });
  return response;
}

function cacheKey(input: RequestInfo | URL): string {
  return new URL(input instanceof Request ? input.url : String(input), ORIGIN).href;
}

function createWorker() {
  const listeners = new Map<string, WorkerListener>();
  const stores = new Map<string, Map<string, Response>>();
  const requests: Request[] = [];
  const fetchRequest = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input instanceof Request ? input : new URL(String(input), ORIGIN), init);
    requests.push(request);
    return publicResponse(request);
  });
  const cachePut = vi.fn(async (store: Map<string, Response>, input: RequestInfo | URL, response: Response) => {
    store.set(cacheKey(input), response.clone());
  });
  const cacheFor = (name: string) => {
    let store = stores.get(name);
    if (!store) {
      store = new Map<string, Response>();
      stores.set(name, store);
    }
    const entries = store;
    return {
      match: async (input: RequestInfo | URL) => entries.get(cacheKey(input))?.clone(),
      put: (input: RequestInfo | URL, response: Response) => cachePut(entries, input, response),
      addAll: async (inputs: Array<RequestInfo | URL>) => {
        // Cache.addAll is atomic. This fake uses only the stubbed fetch above,
        // so the worker cannot make a real network request in these tests.
        const responses = await Promise.all(inputs.map(input => fetchRequest(input)));
        if (responses.some(response => !response.ok)) throw new Error("Precache request failed");
        await Promise.all(inputs.map((input, index) => cachePut(entries, input, responses[index])));
      }
    };
  };
  const caches = {
    open: vi.fn(async (name: string) => cacheFor(name)),
    keys: vi.fn(async () => [...stores.keys()]),
    delete: vi.fn(async (name: string) => stores.delete(name)),
    match: vi.fn(async (input: RequestInfo | URL, options?: { cacheName?: string }) => {
      if (options?.cacheName) return cacheFor(options.cacheName).match(input);
      for (const store of stores.values()) {
        const response = store.get(cacheKey(input));
        if (response) return response.clone();
      }
      return undefined;
    })
  };
  const clients = { claim: vi.fn(async () => undefined), openWindow: vi.fn(),matchAll:vi.fn(async()=>[] as Array<{url:string;navigate:ReturnType<typeof vi.fn>;focus:ReturnType<typeof vi.fn>}>) };
  const showNotification=vi.fn(async()=>undefined);
  const skipWaiting = vi.fn();
  const self = {
    origin: ORIGIN,
    location: new URL(`${ORIGIN}/sw.js`),
    registration: { scope: `${ORIGIN}/`,showNotification },
    clients,
    caches,
    skipWaiting,
    addEventListener: (type: string, listener: WorkerListener) => listeners.set(type, listener)
  };
  runInNewContext(readFileSync("public/sw.js", "utf8"), {
    self, caches, clients, fetch: fetchRequest, URL, Request, Response, Headers,
    origin: ORIGIN, location: self.location, addEventListener: self.addEventListener, skipWaiting,
    console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() }
  }, { filename: "public/sw.js", timeout: 1000 });

  async function dispatch(type: string, request?: Request): Promise<Response | undefined> {
    const listener = listeners.get(type);
    if (!listener) throw new Error(`Worker did not register ${type}`);
    const pending: PromiseLike<unknown>[] = [];
    let response: Response | PromiseLike<Response> | undefined;
    await listener({
      request,
      waitUntil: work => { pending.push(work); },
      respondWith: value => {
        if (response) throw new Error("respondWith called more than once");
        response = value;
      }
    });
    const resolved = response ? await response : undefined;
    await Promise.all(pending);
    return resolved;
  }

  return {
    caches, cachePut, clients, fetchRequest, listeners, requests, skipWaiting, stores,showNotification,
    install: () => dispatch("install"),
    activate: () => dispatch("activate"),
    request: (request: Request) => dispatch("fetch", request),
    seed: (name: string, path: string, response = new Response("another cache's content")) => {
      cacheFor(name);
      stores.get(name)!.set(cacheKey(path), response);
    },
    cachedPaths: () => [...stores.values()].flatMap(store => [...store.keys()].map(key => new URL(key).pathname)).sort()
  };
}

describe("PWA service worker cache boundaries", () => {
  it("precaches only the fixed public fallback and icon without credentials", async () => {
    const worker = createWorker();
    await worker.install();
    expect(worker.requests.map(request => new URL(request.url).pathname).sort()).toEqual([...PUBLIC_PATHS].sort());
    for (const request of worker.requests) {
      expect(request.method).toBe("GET");
      expect(request.credentials).toBe("omit");
      expect(request.headers.has("authorization")).toBe(false);
      expect(request.headers.has("cookie")).toBe(false);
    }
    expect(worker.cachedPaths()).toEqual([...PUBLIC_PATHS].sort());
    expect([...worker.stores.keys()]).toHaveLength(1);
    expect([...worker.stores.keys()][0]).toMatch(/^mound-hounds-pwa-.*v2/);
    expect(worker.skipWaiting).not.toHaveBeenCalled();
  });

  it("fails installation instead of caching an unsuccessful precache response", async () => {
    const worker = createWorker();
    worker.fetchRequest.mockResolvedValue(new Response("not an offline page", { status: 503 }));
    await expect(worker.install()).rejects.toThrow();
    expect(worker.cachedPaths()).toEqual([]);
    expect(worker.clients.claim).not.toHaveBeenCalled();
  });

  it("fetches private documents without the browser HTTP cache and never stores their response", async () => {
    const worker = createWorker();
    await worker.install();
    worker.fetchRequest.mockResolvedValue(new Response("private participant and standings details"));
    worker.requests.length = 0;
    // A response mock still records the effective request through this wrapper.
    worker.fetchRequest.mockImplementation(async (input, init) => {
      worker.requests.push(new Request(input instanceof Request ? input : new URL(String(input), ORIGIN), init));
      return new Response("private participant and standings details");
    });
    const initialWrites = worker.cachePut.mock.calls.length;
    for (const route of ["/dashboard", "/picks?race=18", "/leaderboard", "/admin?tab=participants"]) {
      const response = await worker.request(browserRequest(route, { mode: "navigate" }));
      expect(await response?.text()).toBe("private participant and standings details");
    }
    expect(worker.requests).toHaveLength(4);
    expect(worker.requests.every(request => request.cache === "no-store")).toBe(true);
    expect(worker.cachedPaths()).toEqual([...PUBLIC_PATHS].sort());
    expect(worker.cachePut).toHaveBeenCalledTimes(initialWrites);
  });

  it("shows the public offline explanation only when document networking rejects", async () => {
    const worker = createWorker();
    await worker.install();
    const initialWrites = worker.cachePut.mock.calls.length;
    worker.fetchRequest.mockRejectedValue(new TypeError("Network is unavailable"));
    const response = await worker.request(browserRequest("/picks?race=18", { mode: "navigate" }));
    expect(response?.status).toBe(503);
    expect(response?.headers.get("cache-control")).toBe("no-store");
    expect(await response?.text()).toBe(OFFLINE_HTML);
    expect(worker.cachedPaths()).toEqual([...PUBLIC_PATHS].sort());
    expect(worker.cachePut).toHaveBeenCalledTimes(initialWrites);
  });

  it.each([401, 403, 404, 500, 503])("preserves HTTP %i instead of presenting it as offline", async status => {
    const worker = createWorker();
    await worker.install();
    worker.fetchRequest.mockResolvedValue(new Response("server response", { status }));
    const initialWrites = worker.cachePut.mock.calls.length;
    const response = await worker.request(browserRequest("/dashboard", { mode: "navigate" }));
    expect(response?.status).toBe(status);
    expect(await response?.text()).toBe("server response");
    expect(worker.cachePut).toHaveBeenCalledTimes(initialWrites);
  });

  it("serves the exact public icon from its fixed cache when offline", async () => {
    const worker = createWorker();
    await worker.install();
    worker.fetchRequest.mockClear();
    worker.fetchRequest.mockRejectedValue(new TypeError("Network is unavailable"));
    const response = await worker.request(browserRequest("/icons/icon-192.png", { destination: "image" }));
    expect(await response?.text()).toBe("public asset /icons/icon-192.png");
    expect(worker.fetchRequest).not.toHaveBeenCalled();
    expect(worker.cachedPaths()).toEqual([...PUBLIC_PATHS].sort());
  });

  it("does not create cache entries for asset queries or other runtime resources", async () => {
    const worker = createWorker();
    await worker.install();
    const initialWrites = worker.cachePut.mock.calls.length;
    worker.fetchRequest.mockClear();
    for (let index = 0; index < 30; index++) {
      expect(await worker.request(browserRequest(`/icons/icon-192.png?version=${index}`, { destination: "image" }))).toBeUndefined();
    }
    for (const path of ["/icons/icon-512.png", "/images/branding/mound-hound.webp", "/manifest.webmanifest"]) {
      expect(await worker.request(browserRequest(path))).toBeUndefined();
    }
    expect(worker.fetchRequest).not.toHaveBeenCalled();
    expect(worker.cachePut).toHaveBeenCalledTimes(initialWrites);
    expect(worker.cachedPaths()).toEqual([...PUBLIC_PATHS].sort());
  });

  it("deletes only obsolete caches in its own namespace and claims clients without forced reload", async () => {
    const worker = createWorker();
    worker.seed(`${CACHE_PREFIX}v0`, "/offline.html");
    worker.seed("unrelated-app-cache", "/other-app-data");
    await worker.install();
    const currentCache = [...worker.stores.keys()].find(name => name.startsWith(CACHE_PREFIX) && name !== `${CACHE_PREFIX}v0`)!;
    await worker.activate();
    expect(worker.caches.delete.mock.calls.map(([name]) => name)).toEqual([`${CACHE_PREFIX}v0`]);
    expect([...worker.stores.keys()].sort()).toEqual([currentCache, "unrelated-app-cache"].sort());
    expect(worker.clients.claim).toHaveBeenCalledOnce();
    expect(worker.clients.openWindow).not.toHaveBeenCalled();
    expect(worker.skipWaiting).not.toHaveBeenCalled();
    expect([...worker.listeners.keys()].sort()).toEqual(["activate", "fetch", "install", "message", "notificationclick", "push"]);
  });
});

describe("PWA service worker leaves data traffic to the browser without replay", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE"])("never intercepts or queues %s submissions", async method => {
    const worker = createWorker();
    await worker.install();
    worker.fetchRequest.mockClear();
    const initialWrites = worker.cachePut.mock.calls.length;
    const response = await worker.request(browserRequest("/picks", {
      method, body: JSON.stringify({ driverId: 42 }), headers: { "Next-Action": "fictional-action" }
    }));
    expect(response).toBeUndefined();
    expect(worker.fetchRequest).not.toHaveBeenCalled();
    expect(worker.cachePut).toHaveBeenCalledTimes(initialWrites);
  });

  const dataRequests: Array<{ path: string } & BrowserRequestOptions> = [
    { path: "/api", mode: "navigate" as const },
    { path: "/api/admin/season-backups", mode: "navigate" as const },
    { path: "/_next", mode: "navigate" as const },
    { path: "/_next/static/chunk.js", mode: "navigate" as const },
    { path: "/auth/callback?code=fictional-one-use-code", mode: "navigate" as const },
    { path: "/dashboard?_rsc=fictional-flight-request", mode: "navigate" as const },
    { path: "/picks", mode: "navigate" as const, headers: { RSC: "1" } },
    { path: "/picks", mode: "navigate" as const, headers: { "Next-Action": "fictional-action" } },
    { path: "/leaderboard", mode: "cors" as const },
    { path: "/_next/image?url=fictional-image", mode: "cors" as const },
    { path: "https://fixture.supabase.co/rest/v1/profiles", mode: "cors" as const },
    { path: "https://outside.example/account", mode: "navigate" as const }
  ];

  it.each(dataRequests)("does not intercept $path ($mode)", async ({ path, ...options }) => {
    const worker = createWorker();
    await worker.install();
    worker.fetchRequest.mockClear();
    const initialWrites = worker.cachePut.mock.calls.length;
    expect(await worker.request(browserRequest(path, options))).toBeUndefined();
    expect(worker.fetchRequest).not.toHaveBeenCalled();
    expect(worker.cachePut).toHaveBeenCalledTimes(initialWrites);
  });
});


describe("visible push events without private caching",()=>{
 it.each([null,{title:"Fixture",body:"Review results",url:"/admin?tab=results&result_race_id=1",tag:"fixture"},"malformed"])("always displays a notification for %j",async value=>{
 const worker=createWorker();const pending:PromiseLike<unknown>[]=[];
 worker.listeners.get("push")!({data:{json:()=>{if(value==="malformed")throw new Error("bad");return value;}},respondWith:()=>{},waitUntil:work=>pending.push(work)});await Promise.all(pending);
 expect(worker.showNotification).toHaveBeenCalledOnce();expect(worker.fetchRequest).not.toHaveBeenCalled();expect(worker.stores.size).toBe(0);
 });
 it.each(["https://evil.invalid/","/admin?tab=results&result_race_id=1"])("opens only a safe app destination %s",async url=>{const worker=createWorker();const close=vi.fn(),pending:PromiseLike<unknown>[]=[];worker.listeners.get("notificationclick")!({notification:{data:{url},close},respondWith:()=>{},waitUntil:work=>pending.push(work)});await Promise.all(pending);expect(close).toHaveBeenCalledOnce();expect(worker.clients.openWindow).toHaveBeenCalledWith(url.startsWith("/")?ORIGIN+url:ORIGIN+"/picks");expect(worker.stores.size).toBe(0);});
});

it("focuses an existing app window after navigating to the notification target",async()=>{
 const worker=createWorker(),navigate=vi.fn(),focus=vi.fn();navigate.mockResolvedValue({focus});worker.clients.matchAll.mockResolvedValue([{url:ORIGIN+"/dashboard",navigate,focus}]);
 const work:PromiseLike<unknown>[]=[];worker.listeners.get("notificationclick")!({notification:{data:{url:"/picks"},close:vi.fn()},respondWith:()=>{},waitUntil:value=>work.push(value)});await Promise.all(work);
 expect(navigate).toHaveBeenCalledWith(ORIGIN+"/picks");expect(focus).toHaveBeenCalledOnce();expect(worker.clients.openWindow).not.toHaveBeenCalled();expect(worker.stores.size).toBe(0);
});

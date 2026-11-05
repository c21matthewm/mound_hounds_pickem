/* Only public recovery assets belong here. Never cache league or account data. */
const CACHE_PREFIX = "mound-hounds-pwa-";
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const OFFLINE_URL = "/offline.html";
const PUBLIC_ASSETS = [OFFLINE_URL, "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(PUBLIC_ASSETS.map((pathname) => new Request(
      new URL(pathname, self.location.origin), { cache: "reload", credentials: "omit" }
    )));
    // Updates wait for existing tabs to close. Never interrupt an unsaved form.
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname === "/api" || url.pathname.startsWith("/api/") ||
      url.pathname === "/_next" || url.pathname.startsWith("/_next/") ||
      url.searchParams.has("_rsc") || url.pathname === "/auth/callback" || url.pathname.startsWith("/auth/callback/") ||
      request.headers.has("RSC") || request.headers.has("Next-Action")) return;

  if (!url.search && PUBLIC_ASSETS.includes(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      return (await cache.match(url.pathname)) || fetch(request);
    })());
    return;
  }

  if (request.mode === "navigate" && request.destination === "document") {
    event.respondWith((async () => {
      try {
        // Do not use HTTP or Cache Storage copies of authenticated documents.
        // HTTP 4xx/5xx responses remain visible; only network failures fall back.
        return await fetch(request, { cache: "no-store" });
      } catch {
        const cache = await caches.open(CACHE_NAME);
        const offline = await cache.match(OFFLINE_URL);
        if (!offline) return Response.error();
        const headers = new Headers(offline.headers);
        headers.set("Cache-Control", "no-store");
        return new Response(offline.body, { status: 503, statusText: "Offline", headers });
      }
    })());
  }
  // RSC, APIs, third-party resources and all writes stay network-only.
  // There is no background sync, submission queue, or automatic retry.
});

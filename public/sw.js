/* Only public recovery assets belong here. Never cache league or account data. */
const CACHE_PREFIX = "mound-hounds-pwa-";
const CACHE_NAME = `${CACHE_PREFIX}v2`;
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


function safeNotificationPath(value) {
  try {const url=new URL(typeof value==="string"?value:"/picks",self.location.origin);return url.origin===self.location.origin&&!url.username&&!url.password?url.pathname+url.search:"/picks";}catch{return "/picks";}
}
self.addEventListener("push",event=>{
  let payload={};try{const parsed=event.data?.json();if(parsed&&typeof parsed==="object"&&!Array.isArray(parsed))payload=parsed;}catch{/* Always show a generic visible notification. */}
  const text=(value,fallback,max)=>typeof value==="string"&&value.trim()?value.slice(0,max):fallback;
  event.waitUntil(self.registration.showNotification(text(payload.title,"Mound Hounds",100),{body:text(payload.body,"Open the app for an update.",500),icon:"/icons/icon-192.png",badge:"/icons/icon-192.png",tag:text(payload.tag,"mound-hounds-update",180),data:{url:safeNotificationPath(payload.url)}}));
});
self.addEventListener("notificationclick",event=>{
  event.notification.close();
  const path=safeNotificationPath(event.notification.data?.url);
  event.waitUntil((async()=>{const target=new URL(path,self.location.origin).href;const windows=await self.clients.matchAll({type:"window",includeUncontrolled:true});
    for(const client of windows){try{if(new URL(client.url).origin===self.location.origin&&"focus" in client){const navigated=await client.navigate(target);await(navigated??client).focus();return;}}catch{/* Try another window or open one. */}}
    await self.clients.openWindow(target);
  })());
});

self.addEventListener("message",event=>{if(event.data?.type==="PUSH_CAPABILITY")event.ports?.[0]?.postMessage({push:true});});

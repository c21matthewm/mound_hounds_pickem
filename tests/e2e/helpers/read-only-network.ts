import type { BrowserContext } from "@playwright/test";

export async function guardReadOnlyRequests(context: BrowserContext, baseURL: string): Promise<string[]> {
  const writes: string[] = [];
  const target = new URL(baseURL);
  await context.route("**/*", async route => {
    const method = route.request().method();
    if (method === "GET" || method === "HEAD") {
      await route.fallback();
      return;
    }
    const pathname = new URL(route.request().url()).pathname;
    writes.push(`${method} ${pathname}`);
    await route.abort("blockedbyclient");
  });
  // WebSocket messages can also write data. Auth pages do not need them.
  await context.routeWebSocket("**/*", async socket => {
    const url = new URL(socket.url());
    const localHmr = target.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) &&
      url.protocol === "ws:" && url.host === target.host && url.pathname === "/_next/webpack-hmr";
    if (localHmr) {
      socket.connectToServer();
      return;
    }
    writes.push("WebSocket connection");
    await socket.close();
  });
  return writes;
}

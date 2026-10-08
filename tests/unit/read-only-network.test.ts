import { describe, expect, it, vi } from "vitest";
import type { BrowserContext, Route, WebSocketRoute } from "@playwright/test";
import { guardReadOnlyRequests } from "../e2e/helpers/read-only-network";

async function handlers(baseURL = "https://public.example") {
  let requestHandler!: (route: Route) => Promise<void>;
  let socketHandler!: (socket: WebSocketRoute) => Promise<void>;
  const context = {
    route: vi.fn(async (_pattern: string, handler: typeof requestHandler) => { requestHandler = handler; }),
    routeWebSocket: vi.fn(async (_pattern: string, handler: typeof socketHandler) => { socketHandler = handler; })
  } as unknown as BrowserContext;
  const writes = await guardReadOnlyRequests(context, baseURL);
  return { requestHandler, socketHandler, writes };
}

describe("read-only browser requests", () => {
  it("allows GET and HEAD through existing isolation handlers", async () => {
    const { requestHandler, writes } = await handlers();
    for (const method of ["GET", "HEAD"]) {
      const fallback = vi.fn(async () => undefined);
      const abort = vi.fn(async () => undefined);
      const route = { request: () => ({ method: () => method }), fallback, abort } as unknown as Route;
      await requestHandler(route);
      expect(fallback).toHaveBeenCalledTimes(1);
      expect(abort).not.toHaveBeenCalled();
    }
    expect(writes).toEqual([]);
  });
  it("blocks data writes and beacons before sending, with no query values in diagnostics", async () => {
    const { requestHandler, writes } = await handlers();
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      const fallback = vi.fn(async () => undefined);
      const abort = vi.fn(async () => undefined);
      const route = { request: () => ({ method: () => method, url: () => "https://public.example/api/errors?secret=fictional" }), fallback, abort } as unknown as Route;
      await requestHandler(route);
      expect(abort).toHaveBeenCalledWith("blockedbyclient");
      expect(fallback).not.toHaveBeenCalled();
    }
    expect(writes).toEqual(["POST /api/errors", "PUT /api/errors", "PATCH /api/errors", "DELETE /api/errors", "OPTIONS /api/errors"]);
    expect(JSON.stringify(writes)).not.toContain("fictional");
  });
  it("closes production WebSockets before they can send messages", async () => {
    const { socketHandler, writes } = await handlers();
    const close = vi.fn(async () => undefined);
    const connectToServer = vi.fn();
    await socketHandler({ url: () => "wss://public.example/live", close, connectToServer } as unknown as WebSocketRoute);
    expect(close).toHaveBeenCalledTimes(1);
    expect(connectToServer).not.toHaveBeenCalled();
    expect(writes).toEqual(["WebSocket connection"]);
  });
  it("preserves local Next dev reloads without allowing foreign or data sockets", async () => {
    const { socketHandler, writes } = await handlers("http://127.0.0.1:3007");
    const connectToServer = vi.fn();
    const close = vi.fn(async () => undefined);
    await socketHandler({ url: () => "ws://127.0.0.1:3007/_next/webpack-hmr", close, connectToServer } as unknown as WebSocketRoute);
    expect(connectToServer).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
    for (const url of ["ws://127.0.0.1:3008/_next/webpack-hmr", "wss://foreign.example/_next/webpack-hmr", "ws://127.0.0.1:3007/live"]) {
      await socketHandler({ url: () => url, close, connectToServer } as unknown as WebSocketRoute);
    }
    expect(connectToServer).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(3);
    expect(writes).toHaveLength(3);
  });
});

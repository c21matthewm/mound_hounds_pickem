import path from "node:path";
import sharp from "sharp";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import manifest from "../../src/app/manifest";
import { middleware } from "../../middleware";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  getSupabaseEnv: vi.fn(),
  getUser: vi.fn(),
  network: vi.fn()
}));

vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));
vi.mock("../../src/lib/supabase/env", () => ({ getSupabaseEnv: mocks.getSupabaseEnv }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSupabaseEnv.mockImplementation(() => {
    throw new Error("Supabase configuration is deliberately unavailable in this fixture.");
  });
  mocks.getUser.mockResolvedValue({ data: { user: null } });
  mocks.createServerClient.mockReturnValue({ auth: { getUser: mocks.getUser } });
  mocks.network.mockImplementation(() => {
    throw new Error("Network access is disabled in PWA metadata tests.");
  });
  vi.stubGlobal("fetch", mocks.network);
});

afterEach(() => {
  try {
    expect(mocks.network).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});

const publicPaths = ["/install", "/manifest.webmanifest", "/sw.js", "/offline.html"];
const publicRequests = publicPaths.flatMap((pathname) =>
  ["GET", "HEAD"].map((method) => ({ method, pathname }))
);

function request(pathname: string, method = "GET") {
  return new NextRequest(new URL(pathname, "https://league.invalid"), { method });
}

describe("installed application metadata", () => {
  it("keeps a stable application identity and standalone launch within the application scope", () => {
    expect(manifest()).toMatchObject({
      id: "/",
      name: "Mound Hounds Pick'em",
      short_name: "Mound Hounds",
      start_url: "/",
      scope: "/",
      display: "standalone",
      lang: "en-US",
      prefer_related_applications: false
    });
    expect(manifest().icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" }),
      expect.objectContaining({ src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" }),
      expect.objectContaining({ src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" })
    ]));
    expect(mocks.getSupabaseEnv).not.toHaveBeenCalled();
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });

  it.each([
    { filename: "apple-touch-icon.png", dimension: 180 },
    { filename: "icon-192.png", dimension: 192 },
    { filename: "icon-512.png", dimension: 512 },
    { filename: "icon-maskable-512.png", dimension: 512 }
  ])("ships a decodable $dimension-pixel PNG for $filename", async ({ filename, dimension }) => {
    const image = sharp(path.join("public", "icons", filename));
    const metadata = await image.metadata();
    expect(metadata).toMatchObject({ format: "png", width: dimension, height: dimension });
    // Full pixel decoding also catches truncated or otherwise invalid icon files.
    const { info } = await image.raw().toBuffer({ resolveWithObject: true });
    expect(info).toMatchObject({ width: dimension, height: dimension });
  });
});

describe("public install and offline resources", () => {
  it.each(publicRequests)("serves $method $pathname without Supabase configuration or an auth refresh", async ({ method, pathname }) => {
    const response = await middleware(request(pathname, method));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("location")).toBeNull();
    expect(mocks.getSupabaseEnv).not.toHaveBeenCalled();
    expect(mocks.createServerClient).not.toHaveBeenCalled();
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it.each([
    { method: "GET", pathname: "/dashboard" },
    { method: "GET", pathname: "/admin" },
    { method: "GET", pathname: "/picks" },
    { method: "GET", pathname: "/leaderboard" },
    { method: "GET", pathname: "/install-admin" },
    { method: "GET", pathname: "/install/dashboard" },
    { method: "HEAD", pathname: "/manifest.webmanifest/admin" },
    { method: "GET", pathname: "/sw.js.map" },
    { method: "GET", pathname: "/offline.html/private" },
    { method: "GET", pathname: "/Install" },
    { method: "POST", pathname: "/install" },
    { method: "POST", pathname: "/manifest.webmanifest" },
    { method: "POST", pathname: "/sw.js" },
    { method: "POST", pathname: "/offline.html" },
    { method: "PUT", pathname: "/install" },
    { method: "OPTIONS", pathname: "/install" }
  ])("does not exempt $method $pathname from the normal configuration/auth pipeline", async ({ method, pathname }) => {
    const response = await middleware(request(pathname, method));
    expect(mocks.getSupabaseEnv).toHaveBeenCalledOnce();
    expect(response.status).toBe(500);
    expect(response.headers.get("x-middleware-next")).not.toBe("1");
    expect(await response.text()).toContain("Deployment configuration error:");
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });

  it.each(["/dashboard", "/admin?tab=health", "/picks", "/leaderboard"])("still requires sign-in for %s when Supabase is configured", async (pathname) => {
    mocks.getSupabaseEnv.mockReturnValue({
      url: "https://supabase.invalid",
      anonKey: "fictional-anon-key"
    });
    const response = await middleware(request(pathname));
    expect(mocks.getSupabaseEnv).toHaveBeenCalledOnce();
    expect(mocks.createServerClient).toHaveBeenCalledOnce();
    expect(mocks.getUser).toHaveBeenCalledOnce();
    expect(response.status).toBe(307);
    const destination = new URL(response.headers.get("location")!);
    expect(destination.origin).toBe("https://league.invalid");
    expect(destination.pathname).toBe("/login");
    expect(destination.searchParams.get("next")).toBe(pathname);
  });
});

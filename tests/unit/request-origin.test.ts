import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasSameRequestOrigin } from "@/lib/request-origin";

const request = (origin: string, host?: string, url = "http://0.0.0.0:3007/api/example") =>
  new Request(url, { headers: { origin, ...(host === undefined ? {} : { host }) } });

beforeEach(() => vi.stubEnv("NODE_ENV", "development"));
afterEach(() => vi.unstubAllEnvs());

describe("browser request origin", () => {
  it.each([
    ["http://localhost:3007", "localhost:3007"],
    ["http://192.168.1.76:3007", "192.168.1.76:3007"],
    ["http://127.0.0.1:3007", "127.0.0.1:3007"],
    ["http://[::1]:3007", "[::1]:3007"],
    ["http://localhost", "localhost:80"]
  ])("accepts a browser request through the dev bind address: %s", (origin, host) => {
    expect(hasSameRequestOrigin(request(origin, host))).toBe(true);
  });

  it("uses Request.url when no Host header was supplied", () => {
    expect(hasSameRequestOrigin(request("http://localhost:3007", undefined,
      "http://localhost:3007/api/example"))).toBe(true);
  });

  it.each([
    ["http://localhost:3008", "localhost:3007"],
    ["https://localhost:3007", "localhost:3007"],
    ["http://other.example:3007", "localhost:3007"],
    ["null", "localhost:3007"],
    ["http://localhost:3007/path", "localhost:3007"],
    ["http://user@localhost:3007", "localhost:3007"],
    ["http://localhost:3007", ""],
    ["http://localhost:3007", "other.example@localhost:3007"],
    ["http://localhost:3007", "localhost:3007/path"],
    ["http://localhost:3007", "localhost:3007?query"],
    ["http://localhost:3007", "localhost:3007#fragment"],
    ["http://localhost:3007", "localhost:99999"],
    ["http://localhost:3007", "localhost:3007,other.example"]
  ])("rejects a different origin or malformed authority: %s / %s", (origin, host) => {
    expect(hasSameRequestOrigin(request(origin, host))).toBe(false);
  });

  it("does not use forwarded hosts to allow another origin", () => {
    const forwarded = request("https://other.example", "localhost:3007");
    forwarded.headers.set("x-forwarded-host", "other.example");
    forwarded.headers.set("x-forwarded-proto", "https");
    expect(hasSameRequestOrigin(forwarded)).toBe(false);
  });

  it("rejects a missing origin", () => {
    expect(hasSameRequestOrigin(new Request("http://localhost:3007"))).toBe(false);
  });

  it("uses only the configured origin in production, regardless of Host", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://league.example");
    expect(hasSameRequestOrigin(request("https://league.example", "internal:3000"))).toBe(true);
    expect(hasSameRequestOrigin(request("http://localhost:3007", "localhost:3007"))).toBe(false);
    expect(hasSameRequestOrigin(request("https://other.example", "other.example"))).toBe(false);
  });

  it("fails closed when production's canonical origin is missing", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    expect(hasSameRequestOrigin(request("http://localhost:3007", "localhost:3007"))).toBe(false);
  });
});

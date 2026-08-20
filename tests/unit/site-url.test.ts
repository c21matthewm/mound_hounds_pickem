import { describe, expect, it } from "vitest";
import { resolveAuthOrigin } from "@/lib/site-url";

describe("resolveAuthOrigin", () => {
  it("uses the configured canonical origin in production", () => {
    expect(
      resolveAuthOrigin({
        configuredUrl: "https://moundhoundspickem.app/path-that-is-ignored",
        nodeEnv: "production",
        requestOrigin: "https://attacker.example"
      })
    ).toBe("https://moundhoundspickem.app");
  });

  it("rejects missing production configuration", () => {
    expect(() =>
      resolveAuthOrigin({
        configuredUrl: "",
        nodeEnv: "production",
        requestOrigin: "https://attacker.example"
      })
    ).toThrow(/NEXT_PUBLIC_SITE_URL/);
  });

  it("allows a localhost request origin during development", () => {
    expect(
      resolveAuthOrigin({
        configuredUrl: "https://moundhoundspickem.app",
        nodeEnv: "development",
        requestOrigin: "http://localhost:3007"
      })
    ).toBe("http://localhost:3007");
  });

  it("does not trust a remote development request origin", () => {
    expect(
      resolveAuthOrigin({
        configuredUrl: "https://moundhoundspickem.app",
        nodeEnv: "development",
        requestOrigin: "https://attacker.example"
      })
    ).toBe("https://moundhoundspickem.app");
  });
});

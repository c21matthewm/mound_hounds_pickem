import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/errors/route";

const mocks = vi.hoisted(() => ({ client: vi.fn(), user: vi.fn(), report: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.client }));
vi.mock("@/lib/app-error-reporter", () => ({ reportAppError: mocks.report }));

const request = (origin = "http://localhost:3007", host = "localhost:3007") =>
  new Request("http://0.0.0.0:3007/api/errors", {
    method: "POST",
    headers: { origin, host, "content-type": "application/json" },
    body: JSON.stringify({ message: "Fixture render failure", route: "/leaderboard" })
  });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NODE_ENV", "development");
  mocks.user.mockResolvedValue({ data: { user: null } });
  mocks.client.mockResolvedValue({ auth: { getUser: mocks.user } });
});
afterEach(() => vi.unstubAllEnvs());

describe("browser error reporting origin", () => {
  it.each(["localhost:3007", "192.168.1.76:3007"])(
    "accepts the dev browser's origin but still requires authentication: %s", async (host) => {
      expect((await POST(request(`http://${host}`, host))).status).toBe(401);
      expect(mocks.user).toHaveBeenCalledOnce();
      expect(mocks.report).not.toHaveBeenCalled();
    }
  );

  it("rejects a foreign origin before authentication or reporting", async () => {
    expect((await POST(request("https://other.example"))).status).toBe(403);
    expect(mocks.client).not.toHaveBeenCalled();
    expect(mocks.report).not.toHaveBeenCalled();
  });

  it("reports an authenticated browser failure through the dev bind address", async () => {
    mocks.user.mockResolvedValue({ data: { user: { id: "fixture-admin" } } });
    mocks.report.mockResolvedValue({ recorded: true, correlationId: "12345678-fixture" });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ reference: "12345678" });
    expect(mocks.report).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      actorProfileId: "fixture-admin", route: "/leaderboard", subsystem: "ui"
    }));
  });
});

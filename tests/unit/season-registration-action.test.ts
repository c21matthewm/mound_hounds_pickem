import { beforeEach, describe, expect, it, vi } from "vitest";
import { setSeasonParticipationAction } from "@/app/actions/auth";

const mocks = vi.hoisted(() => ({
  activeSeason: vi.fn(),
  rateLimit: vi.fn(),
  rpc: vi.fn(),
  invalidate: vi.fn()
}));

vi.mock("next/navigation", () => ({
  redirect: (href: string) => { throw new Error(href); }
}));
vi.mock("@/lib/seasons", () => ({ loadActiveLeagueSeason: mocks.activeSeason }));
vi.mock("@/lib/registration-rate-limit", () => ({ consumeRegistrationAttempt: mocks.rateLimit }));
vi.mock("@/lib/scoring-cache", () => ({ invalidateScoringCache: mocks.invalidate }));
vi.mock("@/lib/app-error-reporter", () => ({
  reportAppError: vi.fn().mockResolvedValue({ recorded: false }),
  errorReference: () => ""
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "fixture-user" } } }) },
    rpc: mocks.rpc
  })
}));
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleSupabaseClient: () => ({ rpc: mocks.rpc })
}));

const registrationForm = () => {
  const form = new FormData();
  form.set("decision", "register");
  form.set("invite_code", "Fixture-Code-7");
  form.set("next", "/picks?race_id=7");
  return form;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.activeSeason.mockResolvedValue({ id: 27 });
  mocks.rateLimit.mockResolvedValue(true);
  mocks.rpc.mockResolvedValue({ error: null });
});

describe("season registration recovery", () => {
  it("returns a field error and preserves the Picks destination on successful retry", async () => {
    mocks.rpc.mockResolvedValueOnce({ error: { message: "The season invite code is incorrect." } });
    const form = registrationForm();

    await expect(setSeasonParticipationAction(form)).resolves.toEqual({
      field: "invite_code",
      message: "The season invite code is incorrect."
    });
    expect(mocks.invalidate).not.toHaveBeenCalled();
    await expect(setSeasonParticipationAction(form)).rejects.toThrow(
      "/picks?race_id=7&message=Season+registration+confirmed."
    );
    expect(mocks.rateLimit).toHaveBeenCalledTimes(2);
    expect(mocks.invalidate).toHaveBeenCalledTimes(1);
  });

  it("returns a retryable message when loading the season fails", async () => {
    mocks.activeSeason.mockRejectedValueOnce(new Error("Database unavailable"));
    await expect(setSeasonParticipationAction(registrationForm())).resolves.toEqual({
      message: "Season registration could not be opened. Please try again."
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("keeps the attempt limit in effect when the UI retries", async () => {
    mocks.rateLimit.mockResolvedValueOnce(false);
    await expect(setSeasonParticipationAction(registrationForm())).resolves.toEqual({
      message: "Too many invite-code attempts. Wait 15 minutes and try again."
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

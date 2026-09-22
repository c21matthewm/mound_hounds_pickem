import { describe, expect, it } from "vitest";
import { buildSeasonInviteLink, inviteCodeFromFragment } from "@/lib/season-invite-links";
describe("Private season invite links", () => {
  it("round-trips reserved characters without putting a private code into the request query", () => {
    const code = "My league +&#?2027";
    const link = new URL(buildSeasonInviteLink("https://league.example", "signup", code)!);
    expect(link.pathname).toBe("/signup");
    expect(link.search).toBe("");
    expect(inviteCodeFromFragment(link.hash)).toBe(code);
    expect(buildSeasonInviteLink("https://league.example", "season-registration", code)).toContain("/season-registration#");
  });
  it("rejects short, oversized, or multiline codes and unsafe URL protocols", () => {
    for(const code of ["short", "x".repeat(65), "secret\n12345"]) expect(buildSeasonInviteLink("https://league.example","signup",code)).toBeNull();
    expect(buildSeasonInviteLink("file:///tmp", "signup", "secret-code")).toBeNull();
    expect(inviteCodeFromFragment("#unrelated=other")).toBeNull();
  });
});

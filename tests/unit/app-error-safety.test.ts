import { describe, expect, it } from "vitest";
import {
  participantSafeErrorMessage,
  sanitizeAppErrorContext,
  sanitizeErrorRoute,
  sanitizeTechnicalSummary
} from "@/lib/app-error-safety";

describe("application error safety", () => {
  it("removes participant identifiers, credentials, tokens, and URL queries", () => {
    const summary = sanitizeTechnicalSummary(
      "user@example.com id 5d43db65-4177-4c60-8ee2-8c067e2dc142 " +
        "invite_code=Hounds2027 authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abcdefghijklmnop " +
        "https://example.com/path?token=secret"
    );

    expect(summary).toContain("[email]");
    expect(summary).toContain("[id]");
    expect(summary).toContain("invite_code=[redacted]");
    expect(summary).toContain("authorization=[redacted]");
    expect(summary).toContain("https://example.com/path");
    expect(summary).not.toContain("Hounds2027");
    expect(summary).not.toContain("user@example.com");
    expect(summary).not.toContain("?token=");
  });

  it("keeps only the explicit safe-context allowlist", () => {
    const context = sanitizeAppErrorContext(
      {
        operation: "publish-results",
        raceId: 143,
        seasonId: 12,
        unsafe: "do not store"
      } as Parameters<typeof sanitizeAppErrorContext>[0]
    );

    expect(context).toEqual({
      operation: "publish-results",
      raceId: 143,
      seasonId: 12
    });
  });

  it("strips query strings and fragments from routes", () => {
    expect(sanitizeErrorRoute("/picks?invite_code=secret#form")).toBe("/picks");
  });

  it("passes through known participant-safe domain errors and masks unknown failures", () => {
    expect(
      participantSafeErrorMessage(
        "Picks are unavailable until Music City Grand Prix results are published.",
        "Try again."
      )
    ).toBe("Picks are unavailable until Music City Grand Prix results are published.");
    expect(
      participantSafeErrorMessage(
        "The opening race pick form opens six days before qualifying.",
        "Try again."
      )
    ).toBe("The opening race pick form opens six days before qualifying.");
    expect(participantSafeErrorMessage("database password=secret", "Try again.")).toBe(
      "Try again."
    );
  });
});

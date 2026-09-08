import { describe, expect, it } from "vitest";
import {
  errorMessage,
  participantSafeErrorMessage,
  sanitizeAppErrorContext,
  sanitizeErrorRoute,
  sanitizeTechnicalSummary
} from "@/lib/app-error-safety";

describe("application error safety", () => {
  it.each([
    "The season invite code is incorrect.",
    "Picks are locked because qualifying has already started.",
    "Picks are locked because the race has already started."
  ])("preserves the participant-safe PostgREST message: %s", (message) => {
    const error = { code: "P0001", details: null, hint: null, message };

    expect(participantSafeErrorMessage(error, "Please try again.")).toBe(message);
    expect(sanitizeTechnicalSummary(error)).toBe(message);
  });

  it("keeps useful structured diagnostics sanitized without exposing additional fields", () => {
    const error = {
      code: "XX000",
      details: "private database details",
      hint: "private database hint",
      message:
        "Failed saving picks for user@example.com\npassword=synthetic-secret " +
        "https://example.com/path?token=synthetic-token"
    };

    expect(sanitizeTechnicalSummary(error)).toBe(
      "Failed saving picks for [email] password=[redacted] https://example.com/path"
    );
    expect(participantSafeErrorMessage(error, "Please try again.")).toBe("Please try again.");
  });

  it("bounds structured diagnostics to the existing summary limit", () => {
    expect(sanitizeTechnicalSummary({ message: "x".repeat(600) })).toHaveLength(500);
  });

  it.each([
    null,
    undefined,
    42,
    {},
    { message: null },
    { message: 42 },
    { message: { text: "The season invite code is incorrect." } },
    { details: "The season invite code is incorrect.", hint: "private database hint" }
  ])("handles missing or nonstring messages safely: %j", (error) => {
    expect(errorMessage(error)).toBe("Unknown error");
    expect(sanitizeTechnicalSummary(error)).toBe("Unknown error");
    expect(participantSafeErrorMessage(error, "Please try again.")).toBe("Please try again.");
  });

  it.each([
    "The season invite code is incorrect.",
    new Error("The season invite code is incorrect.")
  ])("continues accepting string and Error inputs: %s", (error) => {
    expect(errorMessage(error)).toBe("The season invite code is incorrect.");
    expect(participantSafeErrorMessage(error, "Please try again.")).toBe(
      "The season invite code is incorrect."
    );
  });

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

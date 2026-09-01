import { describe, expect, it } from "vitest";
import { isJson, serializeJson } from "@/lib/supabase/json";

describe("Supabase JSON boundaries", () => {
  it("accepts nested JSON documents", () => {
    expect(
      isJson({
        races: [{ id: 12, published: true }],
        season: null
      })
    ).toBe(true);
  });

  it("rejects values that cannot be stored as JSON", () => {
    expect(isJson({ callback: () => undefined })).toBe(false);
    expect(isJson(Symbol("invalid"))).toBe(false);
  });

  it("normalizes operational summaries into JSON-safe values", () => {
    expect(
      serializeJson({
        completedAt: new Date("2026-08-28T12:00:00.000Z"),
        ignored: undefined,
        processed: 4
      })
    ).toEqual({
      completedAt: "2026-08-28T12:00:00.000Z",
      processed: 4
    });
  });
});

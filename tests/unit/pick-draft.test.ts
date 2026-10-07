import { describe, expect, it } from "vitest";
import {
  parsePickDraft,
  pickAverageSpeedsMatch,
  pickDraftMatchesSavedState,
  shouldOfferPickDraftRecovery,
  type PickDraft
} from "@/lib/pick-draft";

const draft: PickDraft = {
  averageSpeed: "135.501",
  savedAt: "2027-05-01T12:00:00.000Z",
  selections: {
    1: 1,
    2: 5,
    3: 9,
    4: 13,
    5: 17,
    6: 21
  },
  version: 1
};

const groupNumbers = [1, 2, 3, 4, 5, 6];

describe("pick draft recovery", () => {
  it("parses valid drafts and rejects malformed storage values", () => {
    expect(parsePickDraft(JSON.stringify(draft))).toEqual(draft);
    expect(parsePickDraft("not-json")).toBeNull();
    expect(parsePickDraft(JSON.stringify({ ...draft, version: 2 }))).toBeNull();
  });

  it("does not offer recovery when the local draft matches the server submission", () => {
    const saved = {
      averageSpeed: draft.averageSpeed,
      savedAt: "2027-05-01T11:59:00.000Z",
      selections: draft.selections
    };

    expect(pickDraftMatchesSavedState(draft, saved, groupNumbers)).toBe(true);
    expect(shouldOfferPickDraftRecovery(draft, saved, groupNumbers)).toBe(false);
  });

  it("offers only a newer, different draft when a server submission exists", () => {
    const differentDraft = {
      ...draft,
      selections: { ...draft.selections, 1: 2 }
    };
    const saved = {
      averageSpeed: draft.averageSpeed,
      savedAt: "2027-05-01T11:00:00.000Z",
      selections: draft.selections
    };

    expect(shouldOfferPickDraftRecovery(differentDraft, saved, groupNumbers)).toBe(true);
    expect(
      shouldOfferPickDraftRecovery(
        { ...differentDraft, savedAt: "2027-05-01T10:00:00.000Z" },
        saved,
        groupNumbers
      )
    ).toBe(false);
  });
});

describe("saved pick comparisons", () => {
  it("compares speed numerically without hiding changed or invalid input", () => {
    expect(pickAverageSpeedsMatch(" 135.50 ", "135.500")).toBe(true);
    expect(pickAverageSpeedsMatch("135.501", "135.500")).toBe(false);
    expect(pickAverageSpeedsMatch("135.5004", "135.500")).toBe(false);
    expect(pickAverageSpeedsMatch("", "135.500")).toBe(false);
    expect(pickAverageSpeedsMatch("invalid", "invalid")).toBe(false);
    expect(pickAverageSpeedsMatch("Infinity", "Infinity")).toBe(false);
  });

  it("does not recover a formatting-only speed edit", () => {
    const saved = { averageSpeed: "135.500", selections: draft.selections, savedAt: "2027-05-01T11:00:00Z" };
    expect(shouldOfferPickDraftRecovery({ ...draft, averageSpeed: "135.5" }, saved, groupNumbers)).toBe(false);
  });

  it("checks all eight Indy groups but ignores absent standard groups", () => {
    const saved = { averageSpeed: draft.averageSpeed, savedAt: draft.savedAt, selections: { ...draft.selections, 7: 25, 8: 29 } };
    const matching = { ...draft, selections: { ...saved.selections } };
    expect(pickDraftMatchesSavedState(matching, saved, [...groupNumbers, 7, 8])).toBe(true);
    expect(pickDraftMatchesSavedState({ ...matching, selections: { ...matching.selections, 8: 30 } }, saved, [...groupNumbers, 7, 8])).toBe(false);
    expect(pickDraftMatchesSavedState(draft, { ...saved, selections: { ...draft.selections, 7: null, 8: null } }, groupNumbers)).toBe(true);
  });
});

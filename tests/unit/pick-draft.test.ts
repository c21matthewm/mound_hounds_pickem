import { describe, expect, it } from "vitest";
import {
  parsePickDraft,
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

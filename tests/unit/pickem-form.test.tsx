import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PickemForm } from "@/components/pickem-form";

const groups = Array.from({ length: 6 }, (_, index) => ({
  groupNumber: index + 1,
  isTopGroup: index < 5,
  drivers: [{ id: index + 1, driverName: `Fixture ${index + 1}`, imageUrl: null, championshipPoints: 0 }]
}));
const props = {
  action: async () => {}, canSubmit: true, draftOwnerId: "fixture-user",
  existingAverageSpeed: "135.500", existingSavedAt: "2027-05-01T12:00:00Z",
  groups, picksLocked: false, raceId: 1,
  savedSelection: Object.fromEntries(groups.map(group => [group.groupNumber, group.drivers[0].id]))
};

describe("pick save feedback", () => {
  it("shows an already saved state without disabling edits", () => {
    const html = renderToStaticMarkup(<PickemForm {...props} />);
    expect(html).toContain("Already saved");
    expect(html).toContain("Your picks are saved. Make a change to submit an updated form.");
    expect(html).toMatch(/<button[^>]+disabled=""[^>]*>Already saved<\/button>/);
    expect(html).not.toMatch(/<fieldset[^>]+ disabled=""/);
  });

  it("keeps first submissions available", () => {
    const html = renderToStaticMarkup(<PickemForm {...props} existingSavedAt={null} />);
    expect(html).toContain("Save Pick&#x27;em Form");
    expect(html).not.toContain("Already saved");
  });

  it("preserves locked pick feedback", () => {
    const html = renderToStaticMarkup(<PickemForm {...props} canSubmit={false} picksLocked />);
    expect(html).toContain("Picks are locked");
    expect(html).not.toContain("Make a change to submit an updated form.");
    expect(html).toMatch(/<fieldset[^>]+disabled=""/);
  });
});

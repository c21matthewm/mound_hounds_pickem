import { describe, expect, it } from "vitest";
import { seasonBackupFilename } from "@/lib/season-recovery";

describe("seasonBackupFilename", () => {
  it("builds a portable, timestamped JSON filename", () => {
    expect(
      seasonBackupFilename({
        createdAt: "2026-07-30T13:45:12.123Z",
        label: "Before R12 results: Music City GP",
        seasonYear: 2026
      })
    ).toBe(
      "mound-hounds-2026-before-r12-results-music-city-gp-2026-07-30T13-45-12-123Z.json"
    );
  });

  it("falls back safely when labels and dates are unusable", () => {
    expect(
      seasonBackupFilename({
        createdAt: "not-a-date",
        label: "!!!",
        seasonYear: 2027
      })
    ).toBe("mound-hounds-2027-backup-undated.json");
  });
});

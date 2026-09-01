import { describe, expect, it } from "vitest";
import { pickWindowOpensAt } from "@/lib/pick-windows";

const race = ({
  fieldFrozenAt = null,
  id,
  qualifyingStartAt,
  roundNumber,
  windowKey
}: {
  fieldFrozenAt?: string | null;
  id: number;
  qualifyingStartAt: string;
  roundNumber: number;
  windowKey: string;
}) => ({
  field_frozen_at: fieldFrozenAt,
  id,
  pick_window_key: windowKey,
  qualifying_start_at: qualifyingStartAt,
  race_date: qualifyingStartAt,
  round_number: roundNumber
});

describe("pick-window opening", () => {
  it("opens the first pick window six days before qualifying", () => {
    const firstRace = race({
      id: 1,
      qualifyingStartAt: "2027-03-07T17:00:00.000Z",
      roundNumber: 1,
      windowKey: "first"
    });
    const secondRace = race({
      id: 2,
      qualifyingStartAt: "2027-03-21T17:00:00.000Z",
      roundNumber: 2,
      windowKey: "second"
    });

    expect(pickWindowOpensAt([firstRace, secondRace], [firstRace])).toBe(
      "2027-03-01T17:00:00.000Z"
    );
    expect(pickWindowOpensAt([firstRace, secondRace], [secondRace])).toBeNull();
  });

  it("applies the first-round boundary to a shared opening pick window", () => {
    const firstRace = race({
      id: 1,
      qualifyingStartAt: "2027-03-07T15:00:00.000Z",
      roundNumber: 1,
      windowKey: "doubleheader"
    });
    const secondRace = race({
      id: 2,
      qualifyingStartAt: "2027-03-07T15:00:00.000Z",
      roundNumber: 2,
      windowKey: "doubleheader"
    });

    expect(pickWindowOpensAt([firstRace, secondRace], [firstRace, secondRace])).toBe(
      "2027-03-01T15:00:00.000Z"
    );
  });

  it("does not re-close a first window after its race field has frozen", () => {
    const firstRace = race({
      fieldFrozenAt: "2027-03-01T15:30:00.000Z",
      id: 1,
      qualifyingStartAt: "2027-03-14T15:00:00.000Z",
      roundNumber: 1,
      windowKey: "first"
    });

    expect(pickWindowOpensAt([firstRace], [firstRace])).toBeNull();
  });
});

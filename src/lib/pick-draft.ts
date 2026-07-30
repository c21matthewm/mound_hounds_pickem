export type PickDraft = {
  averageSpeed: string;
  savedAt: string;
  selections: Record<number, number | null>;
  version: 1;
};

type SavedPickState = {
  averageSpeed: string;
  savedAt: string | null;
  selections: Record<number, number | null>;
};

const normalizedSelections = (
  selections: Record<number, number | null>,
  groupNumbers: number[]
): Array<number | null> =>
  groupNumbers.map((groupNumber) => selections[groupNumber] ?? null);

export const pickDraftStorageKey = (userId: string, raceId: number): string =>
  `mound-hounds:pick-draft:v1:${userId}:${raceId}`;

export const parsePickDraft = (raw: string | null): PickDraft | null => {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PickDraft>;
    if (
      parsed.version !== 1 ||
      typeof parsed.averageSpeed !== "string" ||
      typeof parsed.savedAt !== "string" ||
      !parsed.selections ||
      typeof parsed.selections !== "object" ||
      !Number.isFinite(Date.parse(parsed.savedAt))
    ) {
      return null;
    }

    const selections: Record<number, number | null> = {};
    Object.entries(parsed.selections).forEach(([groupNumberText, driverId]) => {
      const groupNumber = Number(groupNumberText);
      if (!Number.isInteger(groupNumber) || groupNumber < 1 || groupNumber > 8) {
        return;
      }
      selections[groupNumber] =
        typeof driverId === "number" && Number.isInteger(driverId) && driverId > 0
          ? driverId
          : null;
    });

    return {
      averageSpeed: parsed.averageSpeed,
      savedAt: parsed.savedAt,
      selections,
      version: 1
    };
  } catch {
    return null;
  }
};

export const pickDraftMatchesSavedState = (
  draft: PickDraft,
  saved: SavedPickState,
  groupNumbers: number[]
): boolean =>
  draft.averageSpeed.trim() === saved.averageSpeed.trim() &&
  normalizedSelections(draft.selections, groupNumbers).every(
    (driverId, index) =>
      driverId === normalizedSelections(saved.selections, groupNumbers)[index]
  );

export const shouldOfferPickDraftRecovery = (
  draft: PickDraft,
  saved: SavedPickState,
  groupNumbers: number[]
): boolean => {
  if (pickDraftMatchesSavedState(draft, saved, groupNumbers)) {
    return false;
  }

  if (!saved.savedAt) {
    return true;
  }

  return Date.parse(draft.savedAt) > Date.parse(saved.savedAt);
};

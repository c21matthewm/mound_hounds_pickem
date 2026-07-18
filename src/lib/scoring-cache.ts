import "server-only";

import { updateTag } from "next/cache";

export const SCORING_CACHE_TAG = "league-scoring-v2";

export const invalidateScoringCache = (): void => {
  updateTag(SCORING_CACHE_TAG);
};

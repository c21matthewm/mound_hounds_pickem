"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

type RaceScheduleRefreshProps = {
  pickLockAt: string;
  raceStartAt: string;
};

const MIN_REFRESH_GAP_MS = 10_000;
const NEAR_DEADLINE_MS = 8 * 60 * 60 * 1_000;
const NEAR_REFRESH_MS = 60_000;
const FAR_REFRESH_MS = 5 * 60_000;

export function RaceScheduleRefresh({
  pickLockAt,
  raceStartAt
}: RaceScheduleRefreshProps) {
  const router = useRouter();
  const lastRefreshAt = useRef(0);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const refresh = () => {
      if (Date.now() - lastRefreshAt.current < MIN_REFRESH_GAP_MS) {
        return;
      }
      lastRefreshAt.current = Date.now();
      router.refresh();
    };

    const scheduleRefresh = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (document.visibilityState !== "visible") {
        timeoutId = null;
        return;
      }

      const now = Date.now();
      const raceStartMs = Date.parse(raceStartAt);
      const lockMs = Date.parse(pickLockAt);
      if (!Number.isFinite(raceStartMs) || now >= raceStartMs) {
        timeoutId = null;
        return;
      }

      const distanceFromLock = Math.abs(lockMs - now);
      const refreshInterval =
        distanceFromLock <= NEAR_DEADLINE_MS || now >= lockMs
          ? NEAR_REFRESH_MS
          : FAR_REFRESH_MS;
      const lockTransitionDelay = lockMs > now ? lockMs - now + 1_000 : refreshInterval;

      timeoutId = setTimeout(() => {
        refresh();
        scheduleRefresh();
      }, Math.max(MIN_REFRESH_GAP_MS, Math.min(refreshInterval, lockTransitionDelay)));
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refresh();
      }
      scheduleRefresh();
    };
    const handleFocus = () => {
      refresh();
      scheduleRefresh();
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    scheduleRefresh();

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [pickLockAt, raceStartAt, router]);

  return null;
}

"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

type RaceScheduleRefreshProps = {
  lockedDraftKey?: string;
  pickLockAt: string;
  raceId?: number;
  raceStartAt: string;
};

const MIN_REFRESH_GAP_MS = 10_000;
const NEAR_DEADLINE_MS = 8 * 60 * 60 * 1_000;
const NEAR_REFRESH_MS = 60_000;
const FAR_REFRESH_MS = 5 * 60_000;

export function RaceScheduleRefresh({
  lockedDraftKey,
  pickLockAt,
  raceId,
  raceStartAt
}: RaceScheduleRefreshProps) {
  const router = useRouter();
  const lastRefreshAt = useRef(0);

  useEffect(() => {
    if (!lockedDraftKey) return;

    try {
      window.localStorage.removeItem(lockedDraftKey);
    } catch {
      // Storage may be unavailable.
    }
  }, [lockedDraftKey]);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const refresh = () => {
      if (navigator.onLine === false || Date.now() - lastRefreshAt.current < MIN_REFRESH_GAP_MS) {
        return;
      }
      lastRefreshAt.current = Date.now();
      const params = new URLSearchParams(window.location.search);
      const locksAtRaceStart = Date.parse(pickLockAt) === Date.parse(raceStartAt);
      if (raceId !== undefined && locksAtRaceStart && Date.now() >= Date.parse(raceStartAt) && params.get("race_id") !== String(raceId)) {
        // Keep the race whose form was open as the default pick window advances.
        params.set("race_id", String(raceId));
        router.replace("/picks?" + params.toString(), { scroll: false });
      } else {
        router.refresh();
      }
    };

    const scheduleRefresh = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (lockedDraftKey || document.visibilityState !== "visible" || navigator.onLine === false) {
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

    // Pause polling offline. Reconnection schedules the next normal check; it
    // never immediately refreshes or submits an open draft.
    window.addEventListener("offline", scheduleRefresh);
    window.addEventListener("online", scheduleRefresh);
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    scheduleRefresh();

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      window.removeEventListener("offline", scheduleRefresh);
      window.removeEventListener("online", scheduleRefresh);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [lockedDraftKey, pickLockAt, raceId, raceStartAt, router]);

  return null;
}

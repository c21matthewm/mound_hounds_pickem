"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

type RaceScheduleRefreshProps = {
  lockedDraftKey?: string;
  pickLockAt: string;
  pollWhileBlocked?: boolean;
  raceId?: number;
  raceStartAt: string;
};

const MIN_REFRESH_GAP_MS = 10_000;
const BLOCKED_REFRESH_MS = 60_000;
const DEADLINE_BUFFER_MS = 1_000;
const MAX_TIMEOUT_MS = 2_147_483_647;

export function RaceScheduleRefresh({
  lockedDraftKey,
  pickLockAt,
  pollWhileBlocked = false,
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
    const lockMs = Date.parse(pickLockAt);
    const raceStartMs = Date.parse(raceStartAt);
    const deadlineCheckAt = lockMs + DEADLINE_BUFFER_MS;
    let deadlineChecked = false;

    const canRefresh = () => document.visibilityState === "visible" && navigator.onLine !== false;

    const refresh = () => {
      const now = Date.now();
      const checkingDeadline = !lockedDraftKey && !deadlineChecked && now >= deadlineCheckAt;
      if (!canRefresh() || (!checkingDeadline && now - lastRefreshAt.current < MIN_REFRESH_GAP_MS)) {
        return;
      }
      if (checkingDeadline) deadlineChecked = true;
      lastRefreshAt.current = now;

      if (raceId !== undefined && lockMs === raceStartMs && now >= raceStartMs) {
        const params = new URLSearchParams(window.location.search);
        if (params.get("race_id") !== String(raceId)) {
          // Keep the race whose form was open as the default pick window advances.
          params.set("race_id", String(raceId));
          router.replace("/picks?" + params.toString(), { scroll: false });
          return;
        }
      }
      router.refresh();
    };

    const scheduleRefresh = () => {
      if (timeoutId !== null) clearTimeout(timeoutId);
      if (lockedDraftKey || !canRefresh() || !Number.isFinite(lockMs) || deadlineChecked) {
        timeoutId = null;
        return;
      }

      const now = Date.now();
      const nextCheckAt = pollWhileBlocked
        ? Math.min(deadlineCheckAt, now + BLOCKED_REFRESH_MS)
        : deadlineCheckAt;
      timeoutId = setTimeout(() => {
        if (Date.now() >= nextCheckAt) refresh();
        scheduleRefresh();
      }, Math.min(MAX_TIMEOUT_MS, Math.max(DEADLINE_BUFFER_MS, nextCheckAt - now)));
    };

    const refreshOnReturn = () => {
      refresh();
      scheduleRefresh();
    };

    // A reconnect rearms the next check without submitting or immediately refreshing a draft.
    window.addEventListener("offline", scheduleRefresh);
    window.addEventListener("online", scheduleRefresh);
    window.addEventListener("focus", refreshOnReturn);
    document.addEventListener("visibilitychange", refreshOnReturn);
    scheduleRefresh();

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      window.removeEventListener("offline", scheduleRefresh);
      window.removeEventListener("online", scheduleRefresh);
      window.removeEventListener("focus", refreshOnReturn);
      document.removeEventListener("visibilitychange", refreshOnReturn);
    };
  }, [lockedDraftKey, pickLockAt, pollWhileBlocked, raceId, raceStartAt, router]);

  return null;
}

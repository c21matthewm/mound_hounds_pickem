export const RESEND_REQUEST_INTERVAL_MS = 275;
export const RESEND_MAX_API_ATTEMPTS = 3;
export const RESEND_MAX_RETRY_WAIT_MS = 5_000;

export const parseRetryAfterMs = (
  value: string | null,
  nowMs = Date.now()
): number | null => {
  if (!value) {
    return null;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1_000);
  }

  const retryAt = Date.parse(value);
  if (!Number.isFinite(retryAt)) {
    return null;
  }

  return Math.max(0, retryAt - nowMs);
};

export const retryDelayForResendFailure = ({
  attempt,
  errorName,
  retryAfter,
  status
}: {
  attempt: number;
  errorName: string | null;
  retryAfter: string | null;
  status: number;
}): number | null => {
  if (attempt >= RESEND_MAX_API_ATTEMPTS - 1) {
    return null;
  }

  if (status === 429 && errorName !== "rate_limit_exceeded") {
    return null;
  }

  if (status !== 429 && status < 500) {
    return null;
  }

  const providerDelay = parseRetryAfterMs(retryAfter);
  const fallbackDelay = 500 * 2 ** attempt;
  return Math.min(
    Math.max(providerDelay ?? fallbackDelay, RESEND_REQUEST_INTERVAL_MS),
    RESEND_MAX_RETRY_WAIT_MS
  );
};

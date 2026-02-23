import "server-only";

export type CronAuthCheckResult =
  | { ok: true }
  | { ok: false; reason: "invalid_auth" | "missing_auth" | "missing_cron_secret" };

export const checkCronAuthorization = (request: Request): CronAuthCheckResult => {
  const expectedSecret = process.env.CRON_SECRET;

  if (!expectedSecret || expectedSecret.trim().length === 0) {
    // Local development fallback so cron can be tested without env setup.
    if (process.env.NODE_ENV !== "production") {
      return { ok: true };
    }

    return { ok: false, reason: "missing_cron_secret" };
  }

  const expected = expectedSecret.trim();
  const bearerAuthHeader = request.headers.get("authorization")?.trim();
  const directSecretHeader = request.headers.get("x-cron-secret")?.trim();

  if (!bearerAuthHeader && !directSecretHeader) {
    return { ok: false, reason: "missing_auth" };
  }

  if (directSecretHeader && directSecretHeader === expected) {
    return { ok: true };
  }

  if (bearerAuthHeader === `Bearer ${expected}`) {
    return { ok: true };
  }

  return { ok: false, reason: "invalid_auth" };
};

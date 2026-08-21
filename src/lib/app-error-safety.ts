export type AppErrorSafeContext = {
  digest?: string | null;
  entityId?: number | string | null;
  entityType?: string | null;
  httpStatus?: number | null;
  operation?: string | null;
  raceId?: number | null;
  seasonId?: number | null;
};

const MAX_SUMMARY_LENGTH = 500;
const SAFE_CONTEXT_KEYS = new Set<keyof AppErrorSafeContext>([
  "digest",
  "entityId",
  "entityType",
  "httpStatus",
  "operation",
  "raceId",
  "seasonId"
]);

const sanitizeUrl = (value: string): string => {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value;
  }
};

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown error";

export const sanitizeTechnicalSummary = (error: unknown): string => {
  const normalized = errorMessage(error)
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, "[id]")
    .replace(
      /\b(authorization|password|passwd|secret|service[_ -]?role[_ -]?key|api[_ -]?key|invite[_ -]?code)\s*[:=]\s*(?:bearer\s+)?[^\s,;]+/gi,
      "$1=[redacted]"
    )
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[credentials]@")
    .replace(/\b(?:Bearer\s+)?[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{16,}\.?[A-Za-z0-9_-]*\b/g, "[token]")
    .replace(/\b(?:sk|pk|sb)_[A-Za-z0-9_-]{16,}\b/g, "[token]")
    .replace(/https?:\/\/[^\s]+/gi, (url) => sanitizeUrl(url))
    .replace(/\s{2,}/g, " ")
    .trim();

  return (normalized || "Unknown error").slice(0, MAX_SUMMARY_LENGTH);
};

export const sanitizeErrorRoute = (route: string): string => {
  const rawPath = route.trim() || "/unknown";
  try {
    const url = new URL(rawPath, "https://moundhoundspickem.invalid");
    return url.pathname.slice(0, 240) || "/unknown";
  } catch {
    return rawPath.split(/[?#]/, 1)[0].slice(0, 240) || "/unknown";
  }
};

const sanitizeContextString = (value: string): string =>
  sanitizeTechnicalSummary(value).slice(0, 160);

export const sanitizeAppErrorContext = (
  context: AppErrorSafeContext | undefined
): Record<string, boolean | number | string | null> => {
  if (!context) {
    return {};
  }

  return Object.entries(context).reduce<Record<string, boolean | number | string | null>>(
    (safe, [key, value]) => {
      if (!SAFE_CONTEXT_KEYS.has(key as keyof AppErrorSafeContext) || value === undefined) {
        return safe;
      }

      safe[key] = typeof value === "string" ? sanitizeContextString(value) : value;
      return safe;
    },
    {}
  );
};

const EXPECTED_PARTICIPANT_ERRORS: Array<[RegExp, (match: RegExpMatchArray) => string]> = [
  [/^Picks are unavailable until (.+) results are published\.?$/i, (match) => `Picks are unavailable until ${sanitizeTechnicalSummary(match[1]).slice(0, 200)} results are published.`],
  [/^Picks are locked because (qualifying|the race) has already started\.?$/i, (match) => `Picks are locked because ${match[1]} has already started.`],
  [/^Your participant profile is inactive for the current season\.?$/i, () => "Your participant profile is inactive for the current season."],
  [/^Register for this league season before submitting picks\.?$/i, () => "Register for this league season before submitting picks."],
  [/^Select one driver from every group before saving\.?$/i, () => "Select one driver from every group before saving."],
  [/^Enter an average speed between 0 and 300 MPH\.?$/i, () => "Enter an average speed between 0 and 300 MPH."],
  [/^The season invite code is incorrect\.?$/i, () => "The season invite code is incorrect."],
  [/^Too many .*attempts\..*$/i, (match) => match[0]],
  [/^A team with submitted picks cannot leave the active season\.?$/i, () => "A team with submitted picks cannot leave the active season."]
];

export const participantSafeErrorMessage = (
  error: unknown,
  fallback: string
): string => {
  const message = errorMessage(error).trim();
  for (const [pattern, format] of EXPECTED_PARTICIPANT_ERRORS) {
    const match = message.match(pattern);
    if (match) {
      return format(match);
    }
  }

  return fallback;
};

export const adminSafeErrorMessage = (error: unknown, fallback: string): string => {
  const summary = sanitizeTechnicalSummary(error);
  if (
    /password|invite.?code|authorization|bearer|service.?role.?key|api.?key/i.test(summary)
  ) {
    return fallback;
  }
  return summary;
};

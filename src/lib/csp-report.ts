export type SanitizedCspReport = {
  blockedResource: string;
  directive: string;
  document: string;
  line: number | null;
  source: string;
};

const safeUrl = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim()) {
    return "unknown";
  }

  const trimmed = value.trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return parsed.protocol;
    }
    return `${parsed.origin}${parsed.pathname}`.slice(0, 300);
  } catch {
    return trimmed.replace(/[\r\n]/g, " ").slice(0, 120);
  }
};

const safeText = (value: unknown): string =>
  typeof value === "string"
    ? value.replace(/[\r\n]/g, " ").trim().slice(0, 120) || "unknown"
    : "unknown";

const safeLine = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
};

const recordFrom = (value: unknown): SanitizedCspReport | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const envelope = value as Record<string, unknown>;
  const legacy = envelope["csp-report"];
  const reportingBody = envelope.body;
  const body =
    legacy && typeof legacy === "object" && !Array.isArray(legacy)
      ? (legacy as Record<string, unknown>)
      : reportingBody && typeof reportingBody === "object" && !Array.isArray(reportingBody)
        ? (reportingBody as Record<string, unknown>)
        : envelope;

  const directive =
    body["effective-directive"] ??
    body.effectiveDirective ??
    body["violated-directive"] ??
    body.violatedDirective;
  if (typeof directive !== "string" || !directive.trim()) {
    return null;
  }

  return {
    blockedResource: safeUrl(body["blocked-uri"] ?? body.blockedURL),
    directive: safeText(directive),
    document: safeUrl(body["document-uri"] ?? body.documentURL ?? envelope.url),
    line: safeLine(body["line-number"] ?? body.lineNumber),
    source: safeUrl(body["source-file"] ?? body.sourceFile)
  };
};

export const sanitizeCspReports = (value: unknown): SanitizedCspReport[] => {
  const candidates = Array.isArray(value) ? value.slice(0, 10) : [value];
  return candidates
    .map(recordFrom)
    .filter((report): report is SanitizedCspReport => report !== null);
};

import { createHash, timingSafeEqual } from "node:crypto";

export type SourceResultRow = {
  position: number | null; driver_name: string; car_number: string | null;
  laps: number | null; status: string | null; points: number | null; average_speed: number | null;
};
export type SourceResultsPayload = {
  official_evidence?: {kind:"html_header"|"pdf_header";header:string;sha256:string;source_url:string}|null;
  race_id: number; season: number; event_id: string; session_id: string; source_url: string;
  source_status: "official" | "provisional" | "unknown"; race_average_speed: number | null;
  rows: SourceResultRow[];
};
export type AutomationFlag = { code: string; message: string };
export const AUTOMATION_BODY_LIMIT = 131_072;
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
export const hashText = (value: string): string => createHash("sha256").update(value).digest("hex");
export function constantTimeSecret(candidate: string, expected: string): boolean {
  return timingSafeEqual(createHash("sha256").update(candidate).digest(), createHash("sha256").update(expected).digest());
}
export function officialResultsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return value.length <= 1800 && /^https:\/\/(?:www\.)?indycar\.com\//.test(value) && url.protocol === "https:" && ["www.indycar.com", "indycar.com"].includes(url.hostname)
      && !url.username && !url.password && !url.port && !url.hash && url.pathname !== "/";
  } catch { return false; }
}
/** Extract public event/session slugs; the fetcher resolves the official numeric IDs. */
export function officialRacePageIdentity(value: string): { season: number; eventId: string; sessionId: string } | null {
  if (!officialResultsUrl(value)) return null;
  const url = new URL(value);
  const match = /^\/results\/ntt-indycar-series\/(20\d{2}|21\d{2}|2200)\/([a-z0-9]+(?:-[a-z0-9]+)*)\/(race(?:-?[12])?)\/?$/.exec(url.pathname);
  return match && !url.search ? { season: Number(match[1]), eventId: match[2], sessionId: match[3] } : null;
}
const text = (value: unknown, max: number): string => {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error("Invalid result text field.");
  return value.trim();
};
const numberOrNull = (value: unknown, integer = false): number | null => {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 10000 || (integer && !Number.isInteger(value))) {
    throw new Error("Invalid result numeric field.");
  }
  return value;
};
export function parseSourcePayload(value: unknown): SourceResultsPayload {
  if (!isObject(value)) throw new Error("A result payload is required.");
  if (!Number.isSafeInteger(value.race_id) || Number(value.race_id) <= 0 || !Number.isInteger(value.season) || Number(value.season) < 2000 || Number(value.season) > 2200) {
    throw new Error("A valid race and season are required.");
  }
  const sourceUrl = text(value.source_url, 1800);
  if (!officialResultsUrl(sourceUrl)) throw new Error("An exact official INDYCAR HTTPS results URL is required.");
  if (!["official", "provisional", "unknown"].includes(String(value.source_status))) throw new Error("Source status is required.");
  if (!Array.isArray(value.rows) || value.rows.length === 0 || value.rows.length > 100) throw new Error("Supply 1–100 result rows.");
  const evidence=value.official_evidence;
  let officialEvidence:SourceResultsPayload["official_evidence"]=null;
  if(evidence!=null){
    if(!isObject(evidence)||!["html_header","pdf_header"].includes(String(evidence.kind))||typeof evidence.header!=="string"||evidence.header.length>150||typeof evidence.sha256!=="string"||! /^[a-f0-9]{64}$/.test(evidence.sha256)||typeof evidence.source_url!=="string")throw new Error("Invalid official evidence.");
    const bound=evidence.kind==="html_header"?evidence.source_url===sourceUrl:/^https:\/\/www\.imscdn\.com\/INDYCAR\/Documents\/\d+\/\d+\/indycar-race-results\.pdf$/.test(evidence.source_url);
    if(!bound)throw new Error("Unbound official evidence.");
    officialEvidence={kind:evidence.kind as "html_header"|"pdf_header",header:evidence.header,sha256:evidence.sha256,source_url:evidence.source_url};
  }
  const rows = value.rows.map((row): SourceResultRow => {
    if (!isObject(row)) throw new Error("Invalid result row.");
    return {
      position: numberOrNull(row.position, true), driver_name: text(row.driver_name, 120),
      car_number: row.car_number == null ? null : text(row.car_number, 10), laps: numberOrNull(row.laps, true),
      status: row.status == null ? null : text(row.status, 120), points: numberOrNull(row.points, true),
      average_speed: numberOrNull(row.average_speed)
    };
  }).sort((a, b) => (a.position ?? 10000) - (b.position ?? 10000) || a.driver_name.localeCompare(b.driver_name));
  return {
    official_evidence:officialEvidence,
    race_id: Number(value.race_id), season: Number(value.season), event_id: text(value.event_id, 128),
    session_id: text(value.session_id, 64), source_url: sourceUrl,
    source_status: value.source_status as SourceResultsPayload["source_status"],
    race_average_speed: numberOrNull(value.race_average_speed), rows
  };
}
export const sourcePayloadHash = (payload: SourceResultsPayload): string => hashText(JSON.stringify(payload));

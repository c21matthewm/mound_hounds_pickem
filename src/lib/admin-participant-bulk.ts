export type ParticipantBulkOperation = "enable" | "disable" | "register" | "decline";
export type ParticipantEnrollmentStatus = "registered" | "declined" | null;
export type ParticipantBulkExpected = {
  profile_id: string;
  expected_is_active: boolean;
  expected_status: ParticipantEnrollmentStatus;
};
export type ParticipantBulkState = { ok: boolean; message: string };
export const MAX_BULK_PARTICIPANTS = 100;
export const MAX_BULK_PARTICIPANT_BYTES = 25_000;
export const initialParticipantBulkState: ParticipantBulkState = { ok: false, message: "" };

export function parseParticipantBulkRequest(formData: FormData): {
  operation: ParticipantBulkOperation; seasonId: number | null; participants: ParticipantBulkExpected[];
} {
  const operation = formData.get("operation");
  if (operation !== "enable" && operation !== "disable" && operation !== "register" && operation !== "decline") {
    throw new Error("Choose an eligibility or season registration action.");
  }
  if (formData.get("confirm_bulk_update") !== "yes") throw new Error("Confirm the selected participant changes.");
  const enrollment = operation === "register" || operation === "decline";
  const rawSeason = formData.get("participant_season_id");
  const seasonId = enrollment && typeof rawSeason === "string" ? Number(rawSeason) : null;
  if (enrollment && (!Number.isSafeInteger(seasonId) || !seasonId || seasonId <= 0)) {
    throw new Error("Choose an active or upcoming season for registration changes.");
  }
  const raw = formData.get("participants");
  if (typeof raw !== "string" || new TextEncoder().encode(raw).length > MAX_BULK_PARTICIPANT_BYTES) {
    throw new Error("Select between 1 and 100 participant accounts.");
  }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("Refresh Participants and select the accounts again."); }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > MAX_BULK_PARTICIPANTS) {
    throw new Error("Select between 1 and 100 participant accounts.");
  }
  const seen = new Set<string>();
  const participants = parsed.map((entry: unknown): ParticipantBulkExpected => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Invalid participant selection.");
    const row = entry as Record<string, unknown>;
    if (typeof row.profile_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.profile_id)
      || typeof row.expected_is_active !== "boolean"
      || ![null, "registered", "declined"].includes(row.expected_status as ParticipantEnrollmentStatus)) {
      throw new Error("Refresh Participants and select the accounts again.");
    }
    const id = row.profile_id.toLowerCase();
    if (seen.has(id)) throw new Error("Each participant may only be selected once.");
    seen.add(id);
    return { profile_id: id, expected_is_active: row.expected_is_active, expected_status: enrollment ? row.expected_status as ParticipantEnrollmentStatus : null };
  });
  return { operation, seasonId, participants };
}

export const SEASON_RULES_BUCKET = "season-rules";
export const MAX_RULES_PDF_BYTES = 5 * 1024 * 1024;
export const RULES_DOCUMENT_MIGRATION = "supabase/migrations/20260919_add_season_rules_documents.sql";

export type RulesUploadState = { status: "idle" | "success" | "error"; message: string };

// Keep this helper safe for client rendering. Storage clients and credentials
// belong only in the server action, never in this module.
export function isSafeRulesDocumentUrl(value: string): boolean {
  if (!value || value.length > 2048 || /[\\\s\u0000-\u001f\u007f]/.test(value)
    || /%(?:0[0-9a-f]|1[0-9a-f]|7f|5c)/i.test(value)) return false;
  if (value.startsWith("/")) return !value.startsWith("//");
  if (!/^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]{1,5})?(?:[/?#]|$)/i.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password &&
      /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(url.hostname) && !url.hostname.includes("..");
  } catch { return false; }
}

export function rulesPdfMetadataError(file: { size: number; type: string }): string | null {
  if (file.size <= 0) return "Choose a PDF containing the season rules.";
  if (file.size > MAX_RULES_PDF_BYTES) return "The rules PDF must be 5 MB or smaller.";
  if (file.type !== "application/pdf") return "Choose a PDF file (.pdf).";
  return null;
}

// Lightweight format validation prevents an HTML/text file renamed to .pdf
// from being served as league rules. It is not a general PDF parser or scanner.
export function hasRulesPdfEnvelope(bytes: Uint8Array): boolean {
  if (bytes.length < 14 || bytes.length > MAX_RULES_PDF_BYTES) return false;
  const decoder = new TextDecoder("latin1");
  const header = decoder.decode(bytes.subarray(0, 9));
  const tail = decoder.decode(bytes.subarray(Math.max(0, bytes.length - 1024)));
  return /^%PDF-(?:1\.[0-7]|2\.0)[\r\n]/.test(header) && /%%EOF[\x00\x09\x0a\x0c\x0d\x20]*$/.test(tail);
}

// A structured database rejection means the RPC transaction rolled back.
// Fetch failures, absent data, gateway errors and unknown errors are ambiguous;
// retaining a unique new object avoids deleting a PDF the database may reference.
export function isConfirmedRulesSaveFailure(code: string | undefined): boolean {
  return ["P0001", "22023", "22001", "42501", "23503", "23505", "23514", "40001", "40P01", "55P03", "57014", "42883", "PGRST202"].includes(code ?? "");
}

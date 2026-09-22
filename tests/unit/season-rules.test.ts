import { describe, expect, it } from "vitest";
import { hasRulesPdfEnvelope, isConfirmedRulesSaveFailure, isSafeRulesDocumentUrl, MAX_RULES_PDF_BYTES, rulesPdfMetadataError } from "@/lib/season-rules";

describe("season rules URL validation", () => {
  it.each(["/docs/rules.pdf", "/docs/Rules%20for%202027.pdf", "https://example.test/rules.pdf", "HTTPS://cdn.example.test:443/rules.pdf?version=2#page=1"])("allows a usable document location: %s", value => {
    expect(isSafeRulesDocumentUrl(value)).toBe(true);
  });
  it.each(["", "//evil.test/a.pdf", "/\\evil.test/a.pdf", "https:\\evil.test/a.pdf", "https:///evil.test", "javascript:alert(1)", "http://example.test/a.pdf", "data:application/pdf;base64,eA==", "https://user:password@example.test/a.pdf", "/docs/a\nb.pdf", "/docs/a\tb.pdf", " https://example.test/rules.pdf", "https://example.test/rules .pdf", "/docs/%0arules.pdf", "/docs/%5crules.pdf", "https://example.test:65536/rules.pdf", "https://a..b/rules.pdf", "https://%65xample.test/rules.pdf", "/" + "x".repeat(2048)])("rejects an unsafe or malformed location: %s", value => {
    expect(isSafeRulesDocumentUrl(value)).toBe(false);
  });
});

describe("rules PDF boundary validation", () => {
  const encode = (value: string) => new TextEncoder().encode(value);
  it("accepts bounded PDFs with a header and final EOF marker", () => {
    expect(hasRulesPdfEnvelope(encode("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n"))).toBe(true);
    expect(hasRulesPdfEnvelope(encode("%PDF-2.0\r\n1 0 obj\n<<>>\nendobj\n%%EOF\r\n"))).toBe(true);
    expect(rulesPdfMetadataError({ size: MAX_RULES_PDF_BYTES, type: "application/pdf" })).toBeNull();
  });
  it.each(["<html>not PDF</html>\n%%EOF", "%PDF-1.7\ntruncated", "%PDF-1.7\n%%EOF<script>bad</script>", "%PDF-9.7\ninvalid\n%%EOF"])("rejects an incomplete or mislabeled envelope", value => {
    expect(hasRulesPdfEnvelope(encode(value))).toBe(false);
  });
  it("rejects empty, oversized and non-PDF files before reading bytes", () => {
    expect(rulesPdfMetadataError({ size: 0, type: "application/pdf" })).toContain("Choose");
    expect(rulesPdfMetadataError({ size: MAX_RULES_PDF_BYTES + 1, type: "application/pdf" })).toContain("5 MB");
    expect(rulesPdfMetadataError({ size: 10, type: "text/html" })).toContain("PDF");
    expect(hasRulesPdfEnvelope(new Uint8Array(MAX_RULES_PDF_BYTES + 1))).toBe(false);
  });
  it("distinguishes confirmed SQL rollback from transport uncertainty", () => {
    for (const code of ["40001", "P0001", "42501", "22023", "55P03", "PGRST202"]) expect(isConfirmedRulesSaveFailure(code)).toBe(true);
    for (const code of [undefined, "", "PGRST003", "ECONNRESET", "503"]) expect(isConfirmedRulesSaveFailure(code)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { sanitizeCspReports } from "@/lib/csp-report";

describe("sanitizeCspReports", () => {
  it("normalizes a legacy report without retaining URL queries", () => {
    expect(
      sanitizeCspReports({
        "csp-report": {
          "blocked-uri": "https://cdn.example/image.png?token=secret",
          "document-uri": "https://moundhoundspickem.app/picks?race_id=123",
          "effective-directive": "img-src",
          "line-number": 42,
          "source-file": "https://moundhoundspickem.app/_next/app.js?build=secret"
        }
      })
    ).toEqual([
      {
        blockedResource: "https://cdn.example/image.png",
        directive: "img-src",
        document: "https://moundhoundspickem.app/picks",
        line: 42,
        source: "https://moundhoundspickem.app/_next/app.js"
      }
    ]);
  });

  it("accepts Reporting API batches and drops unrelated payloads", () => {
    expect(
      sanitizeCspReports([
        {
          body: {
            blockedURL: "inline",
            documentURL: "https://moundhoundspickem.app/dashboard",
            effectiveDirective: "script-src-elem"
          },
          type: "csp-violation"
        },
        { type: "network-error" }
      ])
    ).toEqual([
      {
        blockedResource: "inline",
        directive: "script-src-elem",
        document: "https://moundhoundspickem.app/dashboard",
        line: null,
        source: "unknown"
      }
    ]);
  });
});

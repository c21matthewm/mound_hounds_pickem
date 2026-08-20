import { NextResponse } from "next/server";
import { sanitizeCspReports } from "@/lib/csp-report";

export const dynamic = "force-dynamic";

const MAX_REPORT_BYTES = 16 * 1024;

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REPORT_BYTES) {
    return new NextResponse(null, { status: 204 });
  }

  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_REPORT_BYTES) {
      return new NextResponse(null, { status: 204 });
    }

    const reports = sanitizeCspReports(JSON.parse(raw) as unknown);
    reports.forEach((report) => {
      console.warn("[security:csp-report]", report);
    });
  } catch {
    // Browsers may retry reporting failures; acknowledge malformed reports without storing them.
  }

  return new NextResponse(null, {
    headers: { "Cache-Control": "no-store" },
    status: 204
  });
}

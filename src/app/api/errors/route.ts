import { NextResponse } from "next/server";
import { reportAppError } from "@/lib/app-error-reporter";
import { sanitizeErrorRoute } from "@/lib/app-error-safety";
import { canonicalSiteOrigin } from "@/lib/site-url";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const MAX_REQUEST_BYTES = 4096;

const sameOrigin = (request: Request): boolean => {
  const origin = request.headers.get("origin");
  if (!origin) return false;

  try {
    const expected = process.env.NODE_ENV === "production"
      ? canonicalSiteOrigin()
      : new URL(request.url).origin;
    return new URL(origin).origin === expected;
  } catch {
    return false;
  }
};

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "Invalid error report origin." }, { status: 403 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return NextResponse.json({ error: "Error report is too large." }, { status: 413 });
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json({ error: "Invalid error report." }, { status: 400 });
  }

  if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
    return NextResponse.json({ error: "Error report is too large." }, { status: 413 });
  }

  let body: { digest?: unknown; message?: unknown; route?: unknown };
  try {
    body = JSON.parse(rawBody) as { digest?: unknown; message?: unknown; route?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid error report." }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  const route = sanitizeErrorRoute(typeof body.route === "string" ? body.route : "/unknown");
  const reported = await reportAppError({
    actorProfileId: user.id,
    code: "unhandled-route-error",
    context: {
      digest: typeof body.digest === "string" ? body.digest : null,
      operation: "render"
    },
    error: typeof body.message === "string" ? body.message : "Unhandled route error",
    route,
    severity: "error",
    subsystem: "ui"
  });

  return NextResponse.json({
    reference: reported.recorded
      ? reported.correlationId.slice(0, 8).toUpperCase()
      : null
  });
}

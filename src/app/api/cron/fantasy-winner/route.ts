import { NextResponse } from "next/server";
import { finalizeDueRaceWinners } from "@/lib/fantasy-winner";

type AuthCheckResult =
  | { ok: true }
  | { ok: false; reason: "invalid_auth" | "missing_auth" | "missing_cron_secret" };

const isAuthorized = (request: Request): AuthCheckResult => {
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

async function handleCronRequest(request: Request) {
  const authCheck = isAuthorized(request);
  if (!authCheck.ok) {
    return NextResponse.json({ error: "Unauthorized", reason: authCheck.reason }, { status: 401 });
  }

  try {
    const result = await finalizeDueRaceWinners();
    return NextResponse.json({
      ok: true,
      ...result
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to finalize due fantasy race winners.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return handleCronRequest(request);
}

export async function POST(request: Request) {
  return handleCronRequest(request);
}

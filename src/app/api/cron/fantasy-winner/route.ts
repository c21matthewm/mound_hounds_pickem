import { NextResponse } from "next/server";
import { finalizeDueRaceWinners } from "@/lib/fantasy-winner";

const isAuthorized = (request: Request): boolean => {
  const expectedSecret = process.env.CRON_SECRET;

  if (!expectedSecret) {
    // Local development fallback so cron can be tested without env setup.
    if (process.env.NODE_ENV !== "production") {
      return true;
    }

    return false;
  }

  const authHeader = request.headers.get("authorization");
  return authHeader === `Bearer ${expectedSecret}`;
};

async function handleCronRequest(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

import { NextResponse } from "next/server";
import { checkCronAuthorization } from "@/lib/cron-auth";
import { finalizeDueRaceWinners } from "@/lib/fantasy-winner";
import { withJobRun } from "@/lib/job-runs";

async function handleCronRequest(request: Request) {
  const authCheck = checkCronAuthorization(request);
  if (!authCheck.ok) {
    return NextResponse.json({ error: "Unauthorized", reason: authCheck.reason }, { status: 401 });
  }

  try {
    const result = await withJobRun("fantasy-winner", finalizeDueRaceWinners);
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

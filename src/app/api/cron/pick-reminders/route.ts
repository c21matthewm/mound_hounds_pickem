import { NextResponse } from "next/server";
import { checkCronAuthorization } from "@/lib/cron-auth";
import { sendDuePickReminders } from "@/lib/pick-reminders";

async function handleCronRequest(request: Request) {
  const authCheck = checkCronAuthorization(request);
  if (!authCheck.ok) {
    return NextResponse.json({ error: "Unauthorized", reason: authCheck.reason }, { status: 401 });
  }

  try {
    const result = await sendDuePickReminders();
    return NextResponse.json({
      ok: true,
      ...result
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed running pick reminder notifications.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return handleCronRequest(request);
}

export async function POST(request: Request) {
  return handleCronRequest(request);
}

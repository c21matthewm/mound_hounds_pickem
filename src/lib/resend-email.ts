import "server-only";

import {
  RESEND_MAX_API_ATTEMPTS,
  RESEND_REQUEST_INTERVAL_MS,
  retryDelayForResendFailure
} from "@/lib/resend-rate-limit";

type ResendEmailInput = {
  beforeSend?: () => Promise<boolean>;
  html?: string;
  idempotencyKey: string;
  subject: string;
  text: string;
  to: string;
};

export type ResendEmailResult = {
  id: string | null;
  skipped: boolean;
};

type ResendErrorBody = {
  message?: string;
  name?: string;
};

let nextRequestStartAt = 0;
let requestStartQueue: Promise<void> = Promise.resolve();

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const waitForRequestStart = async (): Promise<void> => {
  const turn = requestStartQueue.then(async () => {
    const waitMs = Math.max(0, nextRequestStartAt - Date.now());
    if (waitMs > 0) {
      await sleep(waitMs);
    }
    nextRequestStartAt = Date.now() + RESEND_REQUEST_INTERVAL_MS;
  });

  requestStartQueue = turn.catch(() => undefined);
  await turn;
};

export const sendResendEmail = async ({
  beforeSend,
  html,
  idempotencyKey,
  subject,
  text,
  to
}: ResendEmailInput): Promise<ResendEmailResult> => {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  const replyTo = process.env.RESEND_REPLY_TO?.trim();

  if (!apiKey) {
    throw new Error("Missing RESEND_API_KEY for pick reminder notifications.");
  }
  if (!from) {
    throw new Error("Missing RESEND_FROM_EMAIL for pick reminder notifications.");
  }

  const payload: {
    from: string;
    html?: string;
    reply_to?: string;
    subject: string;
    text: string;
    to: string[];
  } = {
    from,
    subject,
    text,
    to: [to]
  };

  if (html) {
    payload.html = html;
  }

  if (replyTo) {
    payload.reply_to = replyTo;
  }

  for (let attempt = 0; attempt < RESEND_MAX_API_ATTEMPTS; attempt += 1) {
    await waitForRequestStart();
    if (beforeSend && !(await beforeSend())) {
      return { id: null, skipped: true };
    }

    const response = await fetch("https://api.resend.com/emails", {
      body: JSON.stringify(payload),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
        "User-Agent": "MoundHoundsPickem/1.0"
      },
      method: "POST"
    });

    const body = (await response.json().catch(() => null)) as
      | ({ id?: string } & ResendErrorBody)
      | null;
    if (response.ok) {
      return { id: body?.id ?? null, skipped: false };
    }

    const retryDelay = retryDelayForResendFailure({
      attempt,
      errorName: body?.name ?? null,
      retryAfter: response.headers.get("retry-after"),
      status: response.status
    });
    if (retryDelay !== null) {
      await sleep(retryDelay);
      continue;
    }

    throw new Error(
      `Resend API error (${response.status}): ${body?.message ?? response.statusText}`
    );
  }

  throw new Error("Resend delivery stopped after the configured retry limit.");
};

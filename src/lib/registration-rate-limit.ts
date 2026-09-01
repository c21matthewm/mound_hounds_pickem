import "server-only";

import { createHmac } from "node:crypto";
import { headers } from "next/headers";
import type { AppSupabaseClient } from "@/lib/supabase/types";

const MAX_IDENTITY_ATTEMPTS = 10;
const MAX_SHARED_IP_ATTEMPTS = 100;
const WINDOW_SECONDS = 15 * 60;

const clientAddress = async (): Promise<string> => {
  const requestHeaders = await headers();
  return (
    requestHeaders.get("cf-connecting-ip")?.trim() ||
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    requestHeaders.get("x-real-ip")?.trim() ||
    "unknown"
  );
};

const hashedKey = (value: string): string => {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) {
    throw new Error("Registration protection is not configured.");
  }
  return createHmac("sha256", key).update(value).digest("hex");
};

export const consumeRegistrationAttempt = async ({
  email,
  profileId,
  supabase
}: {
  email?: string;
  profileId?: string;
  supabase: AppSupabaseClient;
}): Promise<boolean> => {
  const address = await clientAddress();
  const identityKeys = [
    email ? `email:${email.trim().toLowerCase()}` : null,
    profileId ? `profile:${profileId}` : null
  ].filter((value): value is string => Boolean(value));

  if (identityKeys.length === 0) {
    throw new Error("Registration protection requires an email or profile identifier.");
  }

  const [ipLimit, identityLimit] = await Promise.all([
    supabase.rpc("consume_registration_attempt", {
      p_key_hashes: [hashedKey(`ip:${address}`)],
      p_max_attempts: MAX_SHARED_IP_ATTEMPTS,
      p_window_seconds: WINDOW_SECONDS
    }),
    supabase.rpc("consume_registration_attempt", {
      p_key_hashes: identityKeys.map(hashedKey),
      p_max_attempts: MAX_IDENTITY_ATTEMPTS,
      p_window_seconds: WINDOW_SECONDS
    })
  ]);

  const error = ipLimit.error ?? identityLimit.error;
  if (error) {
    throw new Error(`Registration protection failed: ${error.message}`);
  }

  return ipLimit.data === true && identityLimit.data === true;
};

import "server-only";

import { createHmac } from "node:crypto";
import { headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

const MAX_ATTEMPTS = 10;
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
  supabase: SupabaseClient;
}): Promise<boolean> => {
  const address = await clientAddress();
  const identifiers = [
    `ip:${address}`,
    email ? `email:${email.trim().toLowerCase()}` : null,
    profileId ? `profile:${profileId}` : null
  ].filter((value): value is string => Boolean(value));
  const { data, error } = await supabase.rpc("consume_registration_attempt", {
    p_key_hashes: identifiers.map(hashedKey),
    p_max_attempts: MAX_ATTEMPTS,
    p_window_seconds: WINDOW_SECONDS
  });

  if (error) {
    throw new Error(`Registration protection failed: ${error.message}`);
  }
  return data === true;
};

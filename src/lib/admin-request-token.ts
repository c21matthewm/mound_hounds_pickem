import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_LIFETIME_SECONDS = 60 * 60;

const signingKey = (): string => {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for protected admin requests.");
  }
  return key;
};

const signatureFor = (payload: string): string =>
  createHmac("sha256", signingKey()).update(payload).digest("base64url");

export const createAdminRequestToken = (userId: string, purpose: string): string => {
  const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_LIFETIME_SECONDS;
  const payload = `${userId}.${purpose}.${expiresAt}.${randomBytes(16).toString("base64url")}`;
  return `${payload}.${signatureFor(payload)}`;
};

export const verifyAdminRequestToken = ({
  purpose,
  token,
  userId
}: {
  purpose: string;
  token: string;
  userId: string;
}): boolean => {
  const parts = token.split(".");
  if (parts.length !== 5) {
    return false;
  }

  const [tokenUserId, tokenPurpose, expiresAtText, , providedSignature] = parts;
  const expiresAt = Number(expiresAtText);
  if (
    tokenUserId !== userId ||
    tokenPurpose !== purpose ||
    !Number.isInteger(expiresAt) ||
    expiresAt < Math.floor(Date.now() / 1000)
  ) {
    return false;
  }

  const payload = parts.slice(0, 4).join(".");
  const expectedSignature = signatureFor(payload);
  const expectedBuffer = Buffer.from(expectedSignature);
  const providedBuffer = Buffer.from(providedSignature);
  return (
    expectedBuffer.length === providedBuffer.length &&
    timingSafeEqual(expectedBuffer, providedBuffer)
  );
};

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { trackClientIssues } from "./helpers/monitoring";

const TEST_PREFIX = `[PW AUTH ${randomUUID().slice(0, 8)}]`;

const readEnvFromFile = (key: string): string | null => {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) {
    return null;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const splitIndex = trimmed.indexOf("=");
    if (splitIndex <= 0) {
      continue;
    }

    const currentKey = trimmed.slice(0, splitIndex).trim();
    if (currentKey !== key) {
      continue;
    }

    const rawValue = trimmed.slice(splitIndex + 1).trim();
    return rawValue.replace(/^['"]|['"]$/g, "");
  }

  return null;
};

const requiredEnv = (key: string): string => {
  const fromProcess = process.env[key];
  if (fromProcess && fromProcess.trim().length > 0) {
    return fromProcess.trim();
  }

  const fromFile = readEnvFromFile(key);
  if (fromFile && fromFile.trim().length > 0) {
    return fromFile.trim();
  }

  throw new Error(`Missing required env var: ${key}`);
};

const supabase = createClient(
  requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

const cleanupUserByTeamName = async (teamName: string) => {
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id")
    .eq("team_name", teamName)
    .maybeSingle<{ id: string }>();

  if (profileError || !profile?.id) {
    return;
  }

  await supabase.from("feedback_items").delete().eq("user_id", profile.id);
  await supabase.from("picks").delete().eq("user_id", profile.id);
  await supabase.from("profiles").delete().eq("id", profile.id);
  await supabase.auth.admin.deleteUser(profile.id);
};

test("public signup validates mismatched passwords and supports successful account creation", async ({
  browserName,
  isMobile,
  page
}) => {
  const clientIssues: string[] = [];
  const label = `public-auth-${browserName}${isMobile ? "-mobile" : ""}`;
  trackClientIssues(page, label, clientIssues);

  const unique = randomUUID().slice(0, 8);
  const fullName = `${TEST_PREFIX} Tester`;
  const teamName = `${TEST_PREFIX} Team ${unique}`;
  const email = `pw-auth-${unique}@example.com`;
  const password = "Pw-Auth-Flow-2026!";

  await page.goto("/signup");
  await expect(page.locator("main")).toContainText("Create account");

  await page.locator('input[name="full_name"]').fill(fullName);
  await page.locator('input[name="team_name"]').fill(teamName);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('input[name="confirm_password"]').fill(`${password}-mismatch`);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.locator("main")).toContainText("Password confirmation does not match.");

  await page.locator('input[name="full_name"]').fill(fullName);
  await page.locator('input[name="team_name"]').fill(teamName);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('input[name="confirm_password"]').fill(password);
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/onboarding|\/login/);
  await expect(page.locator("main")).toContainText(
    /Account created\. Complete your profile to continue\.|Check your email to confirm your account\./
  );

  await cleanupUserByTeamName(teamName);
  expect(clientIssues).toEqual([]);
});

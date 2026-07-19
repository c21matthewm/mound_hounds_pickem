import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { trackClientIssues } from "./helpers/monitoring";
import { cleanupPlaywrightArtifacts } from "./helpers/supabase";

const TEST_PREFIX = `[PW AUTH ${randomUUID().slice(0, 8)}]`;

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

  try {
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

    await expect(page).toHaveURL(/\/onboarding|\/season-registration|\/login/);
    await expect(page.locator("main")).toContainText(
      /Account created\. Complete your profile to continue\.|Season registration|Check your email to confirm your account\./
    );

    expect(clientIssues).toEqual([]);
  } finally {
    await cleanupPlaywrightArtifacts({ recomputeDriverPoints: false });
  }
});

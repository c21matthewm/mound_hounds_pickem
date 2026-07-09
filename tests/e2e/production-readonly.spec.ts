import { expect, test } from "@playwright/test";
import { trackClientIssues } from "./helpers/monitoring";

test("public auth pages load and protected routes redirect without mutating data", async ({ page }) => {
  const clientIssues: string[] = [];
  trackClientIssues(page, "production-readonly", clientIssues);

  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

  await page.goto("/signup");
  await expect(page.getByRole("heading", { name: "Create account" })).toBeVisible();

  await page.goto("/forgot-password");
  await expect(page.getByRole("heading", { name: /reset/i })).toBeVisible();

  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login(?:\?.*)?$/);

  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login(?:\?.*)?$/);

  expect(clientIssues).toEqual([]);
});

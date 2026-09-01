import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("participant contact data retirement", () => {
  it("removes phone collection from onboarding and profile saves", () => {
    const onboarding = readFileSync("src/app/onboarding/page.tsx", "utf8");
    const authActions = readFileSync("src/app/actions/auth.ts", "utf8");

    expect(onboarding).not.toMatch(/phone|carrier/i);
    expect(authActions).not.toContain('formData.get("phone_number")');
    expect(authActions).not.toContain('formData.get("phone_carrier")');
  });

  it("drops stored phone data and constrains reminders to email", () => {
    const migration = readFileSync(
      "supabase/migrations/20260831_retire_sms_participant_data.sql",
      "utf8"
    );

    expect(migration).toContain("drop column if exists phone_number");
    expect(migration).toContain("drop column if exists phone_carrier");
    expect(migration).toContain("check (channel = 'email')");
  });
});

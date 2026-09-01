import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const boundedOperationsMigration = readFileSync(
  "supabase/migrations/20260818_bound_recovery_jobs_and_registration.sql",
  "utf8"
);
const timestampRepairMigration = readFileSync(
  "supabase/migrations/20260831_repair_timestamp_variable_collisions.sql",
  "utf8"
);

describe("operational database functions", () => {
  it("does not use PostgreSQL's current_time keyword as a timestamp variable", () => {
    expect(boundedOperationsMigration).not.toMatch(/\bcurrent_time\s+timestamptz\b/i);
    expect(timestampRepairMigration).not.toMatch(/\bcurrent_time\s+timestamptz\b/i);
  });

  it("repairs registration throttling and scheduled-job heartbeats together", () => {
    expect(timestampRepairMigration).toContain(
      "create or replace function public.consume_registration_attempt"
    );
    expect(timestampRepairMigration).toContain(
      "create or replace function public.start_job_status"
    );
    expect(timestampRepairMigration).toContain("v_now timestamptz := now()");
  });
});

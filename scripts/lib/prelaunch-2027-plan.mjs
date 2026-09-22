import assert from "node:assert/strict";

export const KEEPER_ID = "6badc049-4960-45ee-92e9-5b21dba0d4f1";

export function planAuthRemoval({ inventory, projectFingerprint, reset, keeper, users, profiles, counts, hallOfFame }) {
  assert.equal(inventory.keeperId, KEEPER_ID, "Inventory protects a different administrator.");
  assert.equal(inventory.projectFingerprint, projectFingerprint, "Inventory belongs to a different Supabase project.");
  assert.equal(reset?.keeper_id, KEEPER_ID, "Run the approved SQL cleanup before Auth removal.");
  assert.equal(keeper.id, KEEPER_ID);
  assert.equal(keeper.role, "admin", "Retained account must remain an administrator.");
  assert.equal(keeper.is_active, true, "Retained account must remain active.");
  assert.ok(inventory.authUserIds.includes(KEEPER_ID) && users.includes(KEEPER_ID), "Retained Auth account is missing.");
  assert.ok(users.every((id) => inventory.authUserIds.includes(id)), "New Auth accounts appeared after inventory; stop and review them.");
  assert.ok(profiles.every((profile) => users.includes(profile.id)), "Unexpected profile without an Auth account.");
  assert.ok(profiles.some((profile) => profile.id === KEEPER_ID), "Retained profile is missing.");
  assert.ok(profiles.filter((profile) => profile.id !== KEEPER_ID)
    .every((profile) => profile.role === "participant" && profile.is_active === false),
  "A target account is still active or an administrator; review before deletion.");
  for (const [table, count] of Object.entries(counts)) assert.equal(count, 0, `${table} still contains test data.`);
  assert.deepEqual(hallOfFame, inventory.hallOfFame, "Archived standings changed; review before account removal.");
  // A saved, complete inventory prevents offset-pagination skips while deleting.
  // Missing targets are allowed when safely resuming a partially completed run.
  return [...new Set(inventory.authUserIds.filter((id) => id !== KEEPER_ID && users.includes(id)))].sort();
}

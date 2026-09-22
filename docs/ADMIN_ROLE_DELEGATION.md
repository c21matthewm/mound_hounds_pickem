# Admin role delegation

Implementation is saved; database activation is a manual administrator step. Follow the six-file
sequence in [Admin expansion progress](ADMIN_EXPANSION_PROGRESS.md) if the optional migrations
have not been installed. Do not change real account roles merely to test the controls.


- Apply supabase/migrations/20260913_admin_role_delegation.sql to enable the new role RPC. It does not change any account data or EXPECTED_SCHEMA_VERSION. Until it is applied, the new action fails closed with a setup message.
- The migration definitions and RPC type are mirrored in the consolidated schema and local database contract. The existing protect_profile_role trigger remains part of the schema; preserve it when making future changes.
- Participants requires currentAdminId; emailWarning is optional. Each row accepts email?: string|null. Use the authenticated user's actual UUID, not a form field, for currentAdminId.
- Call loadAdminParticipantEmails(profileIds) only after requireAdmin and only on admin views that need emails. It returns {emailsByProfileId: Map<string,string>, warning: string|null}. Auth data is not cached or exposed wholesale. Empty or failed lookups leave participant management usable.
- Role updates are separately confirmed and preserve profile names, eligibility, and registration. The RPC checks the expected previous role, rechecks the actor, and records audit before/after states in the same transaction. No duplicate recordAdminAudit call is needed in the action.
- is_active means league participation eligibility, not permission to use Admin. Existing is_admin and requireAdmin remain unchanged. Inactive admins retain access. Demotion/deletion of an administrator requires another participation-enabled admin; changing participation eligibility itself retains existing behavior. This is intentionally not a global invariant that some admin must always participate.
- The DB guards cover direct role updates and deletions as well as the RPC. The nonblocking transaction advisory lock also serializes existing is_active changes. Ordered row locks on administrators protect against stale repeatable-read snapshots. A conflicting edit fails promptly with a retry message instead of deadlocking against the existing participant RPC's earlier row lock.
- Role changes take effect at the next server permission check. Revalidation refreshes participant/dashboard/picks/leaderboard data; current sessions need not be deleted or signed out.
- Auth email enumeration is 200 users per page, at most 25 pages, and stops once requested profile IDs are found. Errors or incomplete enumeration discard partial data and produce a warning. Auth responses and emails are never logged. This avoids N+1 getUserById calls and avoids sending unused Auth metadata to the client.

## Verification

Run these only with the local test setup; they do not require real account changes:

```bash
  npm test -- tests/unit/admin-role-actions.test.ts tests/unit/admin-participant-emails.test.ts tests/unit/admin-participant-role-controls.test.tsx
  node scripts/test-admin-role-delegation.mjs
```

The database runner requires an already cached postgres:16-alpine image and a local Docker socket, uses --pull=never --network=none, never reads .env files, and removes only its uniquely named fixture container.

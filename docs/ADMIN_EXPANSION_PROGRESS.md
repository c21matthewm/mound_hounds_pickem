# Admin expansion checkpoint — 2026-09-21

The implementation follows `Admin_changes` while preserving existing scoring, registration and
recovery behavior. The real 2025/2026 spreadsheet archives are already saved; do not re-import
them or rerun the completed experimental-season cleanup.

## Release review and off-season support — 2026-09-21

The latest pass fixes the gap between saving a final archive and ending the active season.
**Save Final Standings** preserves the archive for review; **Complete [year] season** verifies
it, creates a recovery milestone and audit, and leaves the league with no active season. App
archives must match a fresh scoring calculation and the published schedule; historical 2026
closeout requires no leftover operational races. Source changes during review abort the
transaction. Activation now requires the previous season to be explicitly completed first.

Dashboard, Picks, Leaderboard, Rules, participant editing and System Health now account for the
off-season. Completed-year backups remain visible through Recovery's **Backup season** selector;
download/preview is available, and the existing active-season-only restore guard remains.
System Health checks the nine optional Admin capabilities separately from the base schema.

**Installed:** the administrator confirmed applying
[20260921_season_completion.sql](../supabase/migrations/20260921_season_completion.sql) and
reviewing the app without seeing problems. All seven capability migrations are now installed. The new migration does not complete 2026 or activate 2027 automatically.
After reviewing the existing 2026 archive, select **Admin > Seasons & League > Complete 2026
season**. Verify **No active season** before preparing 2027. Do not re-import the archive.

On 2026-09-22, `npm run db:types` regenerated the four new RPC declarations from the installed
schema, its diff was reviewed, and `npm run db:types:check` passed. The generator retains
`p_expected_season_id: number | null` as a required argument; null means no active season.
The administrator is intentionally deferring completion of 2026 and will prepare 2027 when
more official season information is available. These league decisions do not block the
authorized Git release; no live season status was changed during release preparation.
See [the release review](RELEASE_REVIEW_20260921.md) for evidence and the signed-in release checks.

## Live schema follow-up — 2026-09-21

The administrator reports applying all six capability migrations successfully. The requested
`npm run db:types` read confirmed that all six new RPCs are exposed in the deployed Supabase
schema. Types were regenerated, the diff was reviewed, and `npm run db:types:check` passed.
Do not rerun these migrations merely because their installation instructions remain below.

PostgREST omits RPC argument nullability. The generator now explicitly preserves the three
SQL-supported nullable arguments used by account eligibility and rules-document changes,
without making required keys optional or weakening other contracts. It refuses unexpected
types for those arguments. Three offline generator regression tests, changed-file ESLint,
and application TypeScript validation passed. The generated diff contains the expected six
RPC declarations in generated order/format and an updated schema fingerprint; table types
and unrelated RPC contracts are unchanged.

The unresponsive development process was restarted with its old cache moved aside. The login
page returned HTTP 200 at both `http://localhost:3007` and `http://192.168.1.76:3007`; the server
listens on all interfaces. The Wi-Fi address can change. Authenticated System Health review
still belongs to the administrator's signed-in session; schema discovery does not exercise
admin mutations or verify every runtime diagnostic. This follow-up did not modify Supabase data.

## Implemented and saved

- Eight workspaces: Race Week (default), Seasons & League, Participants, Drivers & Groups,
  Race Calendar, System Health, Recovery and Feedback. Legacy `tab=results` opens Race Week's
  Results stage. Navigation uses bounded attention counts for unpublished past races and open
  errors; failed counts remain unknown instead of showing a false all-clear.
- Race Week retains the selected race across Preparation, Picks & Reminders, Results & Audit,
  and Winner. It reuses existing import, scoring audit, manual draft and publication behavior.
  Publishing results calculates the winner immediately; manual recovery remains available.
- Preparation previews current or saved driver groups. **Freeze field now** uses the existing
  snapshot operation, validates active season, opening time, shared deadlines and prior results,
  and saves all shared-window fields with its audit event in one transaction. Repeated freezing
  is safe. Local deadline countdowns do not add server polling. Bookmarked stages also handle
  a season with no races without crashing.
- Corrections, qualifying imports, winner changes, reminder tests and retries preserve the
  selected race/stage, including the second race in a shared doubleheader window.
- Missing-pick monitoring counts every required shared-window form and shows missing teams with
  administrator-only email copying. Clipboard failure offers manual copying on mobile HTTP.
  Reminder preview/test/retry controls retain their existing queue and delivery safeguards.
- Seasons owns create/activate/code/rules setup, activation prerequisites, final archive review,
  explicit completion and an off-season with no active year. Registration links use a URL fragment, prefill signup/returning-member forms,
  remove the code from the browser address, and keep it out of server query strings.
- Historical TSV/CSV import previews names, official placements and totals, validates optional
  complete race-score columns, warns about supplied tiebreak discrepancies and requires one
  champion. Import and audit are atomic; an existing archive cannot be replaced. Normal app
  finalization cannot overwrite the imported 2025/2026 archives.
- Participants includes bounded admin-only email lookup, name/team/email search, selected active
  or upcoming season enrollment, selection and atomic batches of up to 100 accounts. The batch
  either succeeds entirely or changes none. It rejects stale selections and removal where picks
  require individual review. Profile edits carry an expected active-season ID; between seasons they preserve historical and
  upcoming enrollment while allowing names and account eligibility to be managed.
- Role changes use confirmation, expected prior role, actor rechecks and atomic audit. Self-removal
  is blocked, and admin demotion/deletion requires another participation-enabled administrator.
  `is_active` still means league eligibility, not Admin permission; a nonparticipating admin
  retains access. See `ADMIN_ROLE_DELEGATION.md` for the deliberate limits of this guard.
- Drivers supports atomic activation/deactivation of up to 100 selected records with current
  groups refreshed, expected-state checks and audit. Points, opening seeds, saved race fields,
  picks and results remain intact. Missing-photo filtering preserves unsaved row forms and
  identifies selected drivers hidden by the filter. Interrupted or malformed bulk-save responses
  refresh affected views and instruct the admin to check the roster before retrying.
- Rules supports a site path, HTTPS link, or direct PDF upload. Upload checks authorization,
  season status/current URL, 5 MB size and MIME before reading bytes; it checks the PDF envelope
  before privileged Storage access. Unique files are never overwritten. Both URL and upload
  saves use the same optimistic, atomic rules/audit RPC. Older PDFs remain available for recovery;
  a new object is removed only after a confirmed failed database save. Uncertain saves retain it.
- System Health separates technical diagnostics from Race Week. Audit history supports literal
  summary search, exact action/entity filters, 25-event cursor pages and individually loaded
  before/after previews with bounded output and sensitive-field redaction. Error/empty/retry
  states remain explicit. Existing cron, errors, recovery and feedback flows are retained.
- Storage maintenance audits current and recovery references with bounded reads and size/time
  limits, reporting missing references and unreferenced candidates. It has no deletion action.
- Driver and race image replacement/deletion retains earlier files for recovery and shared URLs.
  New uploads use UUID filenames with overwrite disabled. Only a new, request-owned upload may
  be removed after a confirmed database rejection; uncertain outcomes retain it and refresh views.

## Enable the new Admin capabilities

The administrator confirmed all seven capability migrations are installed and the app looked
correct during review. On 2026-09-22, database types were regenerated and `db:types:check`
passed. The full sequence below is retained for other installations; do not rerun it for this
project. Completing 2026 remains an intentional Admin decision, and 2027 will be prepared when
the official season information is available. The application schema version
remains `20260904_portable_season_backups_v2`; a healthy base schema check does not prove that
these optional RPCs have been installed.

1. Open the intended Supabase project and choose **SQL Editor > New query**.
2. Open the first file in the table below in the repository, copy its **entire contents**, paste
   them into the new SQL query, and click **Run**. Each file includes its own transaction.
3. Confirm the query succeeded. If it fails, keep the file unchanged and inspect the error before
   continuing. Do not paste these scripts into the Table Editor or combine them with import data.
4. Repeat **New query → paste the complete file → Run** for each remaining file, in this order.

| Order | File under `supabase/migrations/` | Enables |
| --- | --- | --- |
| 1 | [20260913_admin_role_delegation.sql](../supabase/migrations/20260913_admin_role_delegation.sql) | Confirmed administrator promotion/demotion and removal guards |
| 2 | [20260913_add_historical_hall_of_fame_import.sql](../supabase/migrations/20260913_add_historical_hall_of_fame_import.sql) | Create-only spreadsheet archives and protection from normal finalization |
| 3 | [20260913_admin_freeze_race_field.sql](../supabase/migrations/20260913_admin_freeze_race_field.sql) | Explicit shared-window field freezing |
| 4 | [20260919_bulk_driver_roster.sql](../supabase/migrations/20260919_bulk_driver_roster.sql) | Atomic selected-driver activation/deactivation |
| 5 | [20260919_admin_bulk_participants.sql](../supabase/migrations/20260919_admin_bulk_participants.sql) | Atomic participation and selected-season enrollment changes |
| 6 | [20260919_add_season_rules_documents.sql](../supabase/migrations/20260919_add_season_rules_documents.sql) | Atomic rules URL changes and the public PDF bucket |
| 7 | [20260921_season_completion.sql](../supabase/migrations/20260921_season_completion.sql) | Explicit season completion, guarded activation, off-season profile editing and capability diagnostics |

5. Refresh **Admin > System Health**. Confirm the base schema contract is healthy and all nine
   **Admin capabilities** show **Installed**. This verifies function availability and authenticated
   execution permission, not a live mutation test.
6. Optionally run this read-only SQL to confirm that the capability functions exist:

```sql
select capability,
       case when to_regprocedure(signature) is not null then 'Installed' else 'Missing' end as status
from (values
  ('Admin roles', 'public.admin_update_participant_role(uuid,text,text)'),
  ('Historical imports', 'public.import_historical_hall_of_fame_season(integer,integer,jsonb)'),
  ('Freeze race field', 'public.admin_freeze_race_field(bigint)'),
  ('Driver roster', 'public.admin_set_driver_roster_status(jsonb,boolean)'),
  ('Participant batches', 'public.admin_bulk_update_participants(text,bigint,jsonb)'),
  ('Season rules', 'public.set_league_season_rules_document(bigint,text,text)'),
  ('Closeout review', 'public.get_season_closeout_context(bigint)'),
  ('Season completion', 'public.complete_league_season(bigint,bigint,timestamptz,text,jsonb)'),
  ('Profile editing', 'public.admin_update_participant_v2(uuid,text,text,boolean,boolean,boolean,bigint)')
) as capabilities(capability, signature);
```

7. After installing migrations on another project, run `npm run db:types`, inspect its diff,
   then run `npm run db:types:check`. Keep the explicit nullable expected-season argument used
   for off-season profile changes. The current project passed generation and verification
   against all seven installed migrations on 2026-09-22.
8. Complete the signed-in checks in [the release review](RELEASE_REVIEW_20260921.md) before a main-branch release.

Installing these capabilities does not import seasons, change account roles, change roster
membership, or freeze race fields. The rules migration creates the public `season-rules` bucket
with a 5 MB PDF limit if it does not exist. It refuses incompatible existing bucket settings
instead of changing a private bucket to public. RPC-backed controls fail with setup feedback
until their required migration is installed.

The genuine **2025 and 2026 Hall of Fame archives already exist**. The user confirmed the 2026
import on 2026-09-13. Do not re-import either year or rerun the prelaunch test-data cleanup. Use
fictional accounts, races and archives only in isolated local fixtures for mutation testing.

## Verification checkpoint

The final local source passed **550 unit tests in 59 files**, TypeScript, full ESLint and a
Next.js production build using Webpack. Build/tests used a credential-free copy and preserved
the running development cache. No commit, push, merge, deployment, live mutation, email delivery
or Storage change was performed. The earlier authorized type-generation read is recorded above.

- The new lifecycle suite passed **32 PostgreSQL checks**, using the real recovery builder,
  backup creator and retention functions. It covers historical/app closeout, data and archive
  conflicts, unpublished/future races, one champion, atomic backup/audit rollback, role guards,
  idempotence, upcoming activation, off-season edits and concurrent source writes.
- Existing local SQL suites passed again: **17 role**, **20 driver roster**, **27 participant
  batch** and **14 field freeze** checks. Historical import, rules document and portable recovery
  suites also passed, including concurrent changes, checksums, authorization and audit rollback.
  Every container used fictional data, no network and an already-cached PostgreSQL image.
- The reusable `npm run test:admin:ui` runner passed **70 offline browser checks**: 55 layouts
  across 320/375/390/768/1280px and 15 interactions, including closeout and recovery across season
  boundaries. There were no browser exceptions or attempted network requests. These mocked
  component checks do not exercise live authenticated Supabase workflows or claim manual
  screenshot inspection.
- All **14 RPC/trigger definitions** in the seven optional migrations match their consolidated
  schema definitions exactly, without duplicate definitions.
- After saving, all 33 changed files matched the verified copy and `git diff --check` passed.
  The development server listens on all interfaces at port **3007**. Login returned HTTP 200
  on both `http://localhost:3007` and `http://192.168.1.8:3007`. The Mac's Wi-Fi address changed
  from the earlier `.76` address. Actual phone reachability and authenticated Admin controls
  still need review on the user's device/session after the new migration.

## Deliberately deferred

Coordinated Storage deletion remains deferred. A repeated audit alone cannot protect against a
simultaneous upload, URL edit or restore, and portable backups may reference older media. A shared
media lifecycle must cover all writers before purge is exposed. The legacy CLI considers only
current driver/race references; its `--apply` is not an equivalent safe cleanup. The in-app
read-only audit remains available.

No other item should be assumed complete solely because it appears in the blueprint. The final
verification checkpoint above records the scope and limits of the implemented flows. The smallest
operational next step is to sign in and review **Admin > System Health**, then inspect the new
workspaces without manufacturing real account or archive changes for testing. All seven capability migrations and the regenerated contract are now verified, and the
administrator reports a successful app review. The administrator authorized committing and
pushing dev, merging and pushing main, then returning to dev on 2026-09-22.

# Import the real 2026 Hall of Fame standings

**Completed:** the user confirmed this SQL was run and 2026 is visible in Hall of Fame on
2026-09-13. Keep these files as provenance; do not re-import this year.

This is a one-time data import into the existing Hall of Fame tables. It requires no schema
migration or application deployment. Do not run the experimental-2026 cleanup again.

## Confirmed source

The supplied Google Sheets paste contains 78 teams and 18 race-score columns. Every team's
18 scores add up to its total. Combined participant points are 173,961.

- Champion: **Matt - Team Nash**, 2,684 points.
- Runner-up: **Michael - Lysdexia**, 2,666 points.
- Points per race: **149.11** for the champion.
- Winning margin: **18 points**.
- Last place: **shelley - Brown eyed girl**, 1,086 points.

The original paste is preserved byte for byte in `2026-original.tsv`. Its SHA-256 is
`8e94ec4c70e68a1a624072910aced3c082a6bc927dfa95fa4e5de53d71c0c548`. The SQL retains each original source rank and all 18 scores alongside the
approved final rank. Names, punctuation, capitalization, emoji, and point values are unchanged.
Movement arrows are historical sheet information and are not imported into final standings.

## Approved tied-place corrections

The user explicitly approved applying the final-race tiebreak to these three pairs. The final
score column is treated as the final race. No second-to-last-race comparison was needed for them.

| Final rank to import | Original sheet rank | Participant/team | Season points | Final race |
| --- | --- | --- | --- | --- |
| 26 | 27 | Jonathan - The Greatest Testicles in Racing. | 2451 | 114 |
| 27 | 26 | Billy 4 - Dixon for Seven | 2451 | 111 |
| 39 | 40 | Vivi - The Foreigner | 2342 | 177 |
| 40 | 39 | Jenna - Schmitt faced in turn 2 | 2342 | 158 |
| 42 | 43 | Craig - CRace | 2317 | 115 |
| 43 | 42 | Nicole - Kiwi management | 2317 | 109 |

All other places stay as supplied. Update those three pairs in the Google Sheet separately if
you want the sheet's displayed finishing order to match the archive; this import does not edit Sheets.

## Import steps

1. Open **01_import_2026.sql** in this folder. Click inside the file, press **Command+A**, then
   **Command+C**. Copy the entire SQL file, including `begin;`, the data, `commit;`, and verification.
   You do not need to copy anything else from Google Sheets or use the Supabase CSV importer.
2. Open the Supabase project used by Mound Hounds Pick'em. Select **SQL Editor → New query**.
   If a role selector is shown, use the administrative **postgres** role.
3. Name the query **Import 2026 Hall of Fame**, paste the entire file, and clear any text selection
   so **Run** executes all of it. Click **Run** once.
4. Confirm the final result matches the table below. If Supabase shows only a generic success
   message, create another query, paste all of **02_verify_2026.sql**, and click **Run**.
5. Refresh the app. Open **Standings → Hall of Fame → View 2026 final standings**.
   The local route is `http://localhost:3007/leaderboard?tab=hall&year=2026`.
   On a phone using the same Wi-Fi, use the dev server's Wi-Fi address.

| Result column | Expected value |
| --- | --- |
| `verification_status` | `PASS` |
| `season_year` | `2026` |
| `champion_team_name` | `Matt - Team Nash` |
| `champion_total_points` | `2684` |
| `race_count` | `18` |
| `imported_entries` | `78` |
| `champion_points_per_race` | `149.11` |
| `combined_points` | `173961` |

The verification checks every final rank/name/total using a fingerprint, in addition to the
counts, champion, and combined points. It reports `NOT IMPORTED` if the archive is absent.
If it reports `CHECK IMPORT`, or SQL reports an error, share the result for investigation.
If the import says **2026 already exists**, run the verification file; do not delete or overwrite
that archive and do not bypass a guard. The transaction rolls back on an import failure.

## What the app will show

The existing Hall of Fame automatically adds the 2026 champion card, its full 78-team standings,
and a comparison with the 2025 champion. Expect 18 races, Field Size 78, 149.11 points per race,
and an 18-point winning margin. All six corrected places appear in the final standings.

This creates one `hall_of_fame_seasons` row and 78 linked `hall_of_fame_entries` rows. Database IDs
are generated automatically. The archive's `team_name` stores the full supplied Name - Team label;
it does not match historical entrants to active accounts. Your existing admin account stays intact.

`race_breakdown` stays empty because the paste does not identify race names, dates, or database IDs.
The supplied scores remain in the SQL and original TSV; no historical race records are fabricated.
The database stores the import time, but participants do not see that timestamp.

This does not change the 2025 archive, active season, registration, or paused cron jobs. Do not use
**Admin → Finalize Season / Refresh Final Standings** for this imported 2026 year: that control
calculates app results, while the real 2026 league was run in the spreadsheet. Configure and activate
2027 through the normal season workflow when ready, then resume jobs using the existing prelaunch guide.

## Local validation

Tested in a disposable PostgreSQL 16 container with networking disabled, using the repository's
Hall of Fame table definitions and the existing 2025 import as a fixture. The valid import
returned the expected PASS row and every stored name, rank, and total matched the approved data.
The original TSV matched the supplied paste byte for byte.

Checks also confirmed that malformed scores, missing entries, reversed tiebreak ordering, and
altered names are rejected; a forced failure during entry insertion rolls back the entire import;
a repeat import preserves the existing archive; and verification detects incorrect tied places.
The 2025 archive and fixture admin, driver, active season, and registration records were unchanged.
These tests did not connect to Supabase or change the live application database.

# Import the 2025 Hall of Fame standings

This is a one-time data import for an existing league database. It is not a schema
migration and does not need an application deployment.

## Files

- `01_import_2025.sql`: the complete import, including all 89 entries and a verification result.
- `02_verify_2025.sql`: read-only verification that can be run again at any time.
- `2025-original.tsv`: the original Google Sheets paste, preserved byte for byte.
- `2025-review.csv`: the same data with column headings for review. Do not upload this CSV directly to a Supabase table.

## 1. Check the source in Google Sheets

The data has already been copied out of Sheets and converted into the SQL file.
There is no need to export or upload another file for this season.

Open the original 2025 sheet and confirm these are its final standings:

- 89 entries, with final ranks 1 through 89.
- 17 race-score columns representing the complete season.
- First: Nicholas - Pickle, 2,548 points.
- Second: Matthew - Matty B, 2,543 points.
- Last: Adam - Smoke and mirrors, 933 points.

All 89 supplied totals match the sum of their 17 race scores. Original final ranks,
including the order of equal-point entries, are retained. The full Name - Team label
is stored in the archive's `team_name` field. No attempt is made to match old entries
to current accounts.

If the sheet has changed since the paste, stop and provide the updated data before
running the import. Do not manually change only one part of the generated SQL.

## 2. Copy the prepared SQL

Open `01_import_2025.sql` in the project editor. Click inside the file, press
Command+A, then Command+C. Copy the entire file, including `begin;`, the data, and
the final verification query. Copy this SQL file, not the cells from Google Sheets.

## 3. Open the correct Supabase project

Sign in to the Supabase Dashboard and open the project used by Mound Hounds Pick'em.
Choose **SQL Editor** in the sidebar and create a new query. If a database role
selector is shown, use the project's administrative `postgres` role rather than an
application participant role. The file inserts into the existing Hall of Fame
tables directly; it does not use an application's signed-in user session.

Name the query `Import 2025 Hall of Fame` if the editor offers a query title.

## 4. Paste and run

Paste the full SQL file into the blank editor. Clear any text selection before
clicking **Run**, so the complete script executes.

This creates one `hall_of_fame_seasons` row and 89 linked `hall_of_fame_entries`
rows. The database generates their IDs automatically. The script validates its
input before inserting and rolls back the transaction on an import error. If
2025 already exists, it stops without replacing that archive.

No current-season records, accounts, race results, picks, or table definitions
are changed. The script is specific to the supplied 2025 data; do not change its
year to import another season.

## 5. Check the result

The final query should return one row:

| Column | Expected value |
| --- | --- |
| `verification_status` | `PASS` |
| `season_year` | `2025` |
| `champion_team_name` | `Nicholas - Pickle` |
| `champion_total_points` | `2548` |
| `race_count` | `17` |
| `imported_entries` | `89` |
| `champion_points_per_race` | `149.88` |

If the editor displays only a generic success message, open a separate query,
paste the complete contents of `02_verify_2025.sql`, and run it. That query only
reads data. No returned row means a 2025 archive was not found in that project.

If you receive `2025 already exists`, run the verification file rather than
deleting records or rerunning the import. If verification reports `CHECK IMPORT`
or another error appears, retain the existing records and share the error/result
for investigation.

## 6. Check the application

Sign in to the app, open **Standings**, then **Hall of Fame**, and select
**View 2025 final standings** on the champion card.
Refresh the page if it was already open. The route is
`/leaderboard?tab=hall&year=2025` on your app's existing domain.

Expect the champion, 17 races, Field Size 89, and the full final rank/name/total
table. The champion overview also shows 149.88 points per race and a five-point
winning margin. The import timestamp remains stored but is not shown to participants.

The champions comparison table appears once multiple seasons are archived.
Individual race columns are not added by this import. `race_breakdown` is left as an empty array because the pasted
scores did not include race names, dates, or database IDs. All original race
scores remain available in the adjacent TSV and review CSV for later work.

## Other spreadsheet seasons

Open the appropriate Google Sheets tab and select the complete final leaderboard
rectangle, including headers if available, all participant rows, and all race
columns. Press Command+C and paste it into the chat. Include the season year and
the number of races separately, and mention any special scoring or tiebreak rules.
Each format can be converted and checked separately, then supplied as its own
SQL file. You do not need to restructure the old Google Sheets.

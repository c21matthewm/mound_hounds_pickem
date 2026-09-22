/** Shared by the preview and server action. Historical places are authoritative. */
export const HISTORICAL_IMPORT_LIMITS = {
  characters: 300_000,
  entries: 500,
  races: 100,
  teamName: 160,
  points: 2_147_483_647
} as const;

export type HistoricalImportEntry = {
  final_rank: number;
  team_name: string;
  total_points: number;
  race_breakdown: [];
};

export type HistoricalImportPreview = {
  entries: HistoricalImportEntry[];
  errors: string[];
  warnings: string[];
  raceCount: number | null;
  seasonYear: number | null;
  verifiedRaceScores: boolean;
};

export type HistoricalImportActionState = {
  status: "idle" | "error" | "success";
  message: string;
  seasonYear?: number;
};

type ParsedRow = { cells: string[]; line: number };
const integer = (text: string, maximum: number): number | null => {
  // Thousands separators are accepted only in well-formed, delimited cells.
  const value = text.trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(value)) return null;
  const parsed = Number(value.replaceAll(",", ""));
  return Number.isSafeInteger(parsed) && parsed <= maximum ? parsed : null;
};
const headerKey = (cell: string) => cell.trim().toLowerCase().replace(/[ _-]/g, "");
const rankHeaders = new Set(["rank", "finalrank", "place", "position"]);
const teamHeaders = new Set(["team", "teamname", "participant", "participantname"]);
const totalHeaders = new Set(["total", "totalpoints", "points", "score", "totalscore"]);
const movementHeaders = new Set(["movement", "change", "trend", "move"]);
const isMovement = (cell: string) => /^(?:[▲▼△▽↑↓↔–—-]\s*[+-]?\d*|[+-]\d+|=)$/.test(cell.trim());

function readRows(raw: string): ParsedRow[] {
  const text = raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  // Google Sheets uses tabs; CSV uses commas. Inspect only the first record.
  let quoted = false;
  let delimiter = ",";
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '"') {
      if (quoted && text[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (!quoted && text[index] === "\t") {
      delimiter = "\t";
      break;
    } else if (!quoted && text[index] === "\n") break;
  }

  const rows: ParsedRow[] = [];
  let cells: string[] = [];
  let field = "";
  let inQuotes = false;
  let closedQuote = false;
  let line = 1;
  let rowLine = 1;
  const endField = () => {
    cells.push(field.trim());
    field = "";
    closedQuote = false;
  };
  const endRow = () => {
    endField();
    if (cells.some((cell) => cell !== "")) rows.push({ cells, line: rowLine });
    cells = [];
    if (rows.length > HISTORICAL_IMPORT_LIMITS.entries + 1) {
      throw new Error(`Paste no more than ${HISTORICAL_IMPORT_LIMITS.entries} participants.`);
    }
  };
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') { field += '"'; index += 1; }
        else { inQuotes = false; closedQuote = true; }
      } else {
        field += character;
        if (character === "\n") line += 1;
      }
    } else if (character === delimiter) {
      endField();
    } else if (character === "\n") {
      endRow();
      line += 1;
      rowLine = line;
    } else if (character === '"' && field === "" && !closedQuote) {
      inQuotes = true;
    } else if (closedQuote && character.trim() !== "") {
      throw new Error(`Line ${line}: text after a closing quote is invalid. Copy the cells again.`);
    } else if (character === '"') {
      throw new Error(`Line ${line}: quote the complete cell and double any quotes inside it.`);
    } else if (!closedQuote) field += character;
  }
  if (inQuotes) throw new Error("A quoted cell is incomplete. Copy the complete leaderboard again.");
  endRow();
  return rows;
}

export function parseHistoricalHallOfFameImport(input: {
  seasonYear: string;
  raceCount: string;
  spreadsheet: string;
}): HistoricalImportPreview {
  const seasonYear = integer(input.seasonYear, 2100);
  const raceCount = integer(input.raceCount, HISTORICAL_IMPORT_LIMITS.races);
  const errors: string[] = [];
  const warnings: string[] = [];
  const entries: HistoricalImportEntry[] = [];
  const result: HistoricalImportPreview = { entries, errors, warnings, raceCount, seasonYear, verifiedRaceScores: false };
  const error = (message: string) => { if (errors.length < 12) errors.push(message); };
  if (seasonYear === null || seasonYear < 2000) error("Enter a season year from 2000 through 2100.");
  if (raceCount === null || raceCount < 1) error(`Enter a race count from 1 through ${HISTORICAL_IMPORT_LIMITS.races}.`);
  if (input.spreadsheet.length > HISTORICAL_IMPORT_LIMITS.characters) {
    error("The paste is too large. Include only the final leaderboard, up to 300,000 characters.");
    return result;
  }
  if (!input.spreadsheet.trim()) { error("Paste the final leaderboard to preview the archive."); return result; }
  let rows: ParsedRow[];
  try { rows = readRows(input.spreadsheet.trim()); }
  catch (caught) { error(caught instanceof Error ? caught.message : "Could not read this spreadsheet."); return result; }
  if (!rows.length) { error("No participant rows were found."); return result; }
  const headers = rows[0].cells.map(headerKey);
  const hasHeader = integer(rows[0].cells[0], HISTORICAL_IMPORT_LIMITS.entries) === null && headers.some((header) => rankHeaders.has(header) || teamHeaders.has(header) || totalHeaders.has(header));
  let rankIndex = 0;
  let teamIndex = 1;
  let totalIndex = 2;
  let scoreIndexes: number[];
  let movementIndex = -1;
  let expectedColumns: number;
  if (hasHeader) {
    const matches = (allowed: Set<string>) => headers.flatMap((header, index) => allowed.has(header) ? [index] : []);
    const rankMatches = matches(rankHeaders);
    const teamMatches = matches(teamHeaders);
    const totalMatches = matches(totalHeaders);
    if (rankMatches.length !== 1 || teamMatches.length !== 1 || totalMatches.length !== 1) {
      error("Use exactly one Rank, Team Name, and Total Points column in the header.");
      return result;
    }
    [rankIndex, teamIndex, totalIndex] = [rankMatches[0], teamMatches[0], totalMatches[0]];
    const movements = matches(movementHeaders);
    if (movements.length > 1) { error("Include at most one movement column."); return result; }
    movementIndex = movements[0] ?? -1;
    scoreIndexes = headers.flatMap((_, index) => [rankIndex, teamIndex, totalIndex, movementIndex].includes(index) ? [] : [index]);
    expectedColumns = headers.length;
    rows = rows.slice(1);
  } else {
    if (isMovement(rows[0].cells[1] ?? "")) { movementIndex = 1; teamIndex = 2; totalIndex = 3; }
    expectedColumns = rows[0].cells.length;
    scoreIndexes = Array.from({ length: Math.max(0, expectedColumns - totalIndex - 1) }, (_, index) => totalIndex + index + 1);
  }
  if (!rows.length) { error("Include participant rows below the header."); return result; }
  if (rows.length > HISTORICAL_IMPORT_LIMITS.entries) { error(`Paste no more than ${HISTORICAL_IMPORT_LIMITS.entries} participants.`); return result; }
  if (expectedColumns < 3 || (scoreIndexes.length !== 0 && scoreIndexes.length !== raceCount)) {
    error("Use Rank, Team Name, Total Points, then either no race columns or exactly one score column per race.");
    return result;
  }
  const seenTeams = new Set<string>();
  const raceScores = new Map<HistoricalImportEntry, number[]>();
  for (const row of rows) {
    if (row.cells.length !== expectedColumns) { error(`Line ${row.line}: column count differs from the other rows. Copy a rectangular range of cells.`); continue; }
    if (movementIndex >= 0 && !isMovement(row.cells[movementIndex]) && row.cells[movementIndex] !== "0") {
      error(`Line ${row.line}: the movement column is not recognized.`);
      continue;
    }
    const rank = integer(row.cells[rankIndex] ?? "", HISTORICAL_IMPORT_LIMITS.entries);
    const team = row.cells[teamIndex]?.trim() ?? "";
    const points = integer(row.cells[totalIndex] ?? "", HISTORICAL_IMPORT_LIMITS.points);
    if (rank === null || rank < 1) { error(`Line ${row.line}: rank must be a positive whole number.`); continue; }
    if (!team || team.length > HISTORICAL_IMPORT_LIMITS.teamName || Array.from(team).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
      error(`Line ${row.line}: team name must contain 1–${HISTORICAL_IMPORT_LIMITS.teamName} characters on one line.`); continue;
    }
    if (points === null) { error(`Line ${row.line}: total points must be a nonnegative whole number.`); continue; }
    const nameKey = team.normalize("NFKC").toLowerCase().replace(/\s+/g, " ");
    if (seenTeams.has(nameKey)) { error(`Line ${row.line}: duplicate team name (${team}).`); continue; }
    seenTeams.add(nameKey);
    const scores = scoreIndexes.map((index) => integer(row.cells[index], HISTORICAL_IMPORT_LIMITS.points));
    if (scores.some((score) => score === null)) { error(`Line ${row.line}: every race score must be a nonnegative whole number.`); continue; }
    const checkedScores = scores as number[];
    if (checkedScores.length && checkedScores.reduce((sum, score) => sum + score, 0) !== points) {
      error(`Line ${row.line}: race scores do not add up to the listed total.`); continue;
    }
    const entry: HistoricalImportEntry = { final_rank: rank, team_name: team, total_points: points, race_breakdown: [] };
    entries.push(entry);
    raceScores.set(entry, checkedScores);
  }
  entries.sort((left, right) => left.final_rank - right.final_rank);
  if (entries.filter((entry) => entry.final_rank === 1).length !== 1) {
    error("The archive must have exactly one rank-1 champion. Resolve a shared first place in the source sheet before importing.");
  }
  for (let index = 0; index < entries.length; index += 1) {
    const current = entries[index];
    const previous = entries[index - 1];
    const isSharedRank = previous && previous.final_rank === current.final_rank;
    if ((!isSharedRank && current.final_rank !== index + 1) || (isSharedRank && previous.total_points !== current.total_points)) {
      error("Ranks must start at 1 and be consecutive, or use competition ranks for tied points (for example 1, 2, 2, 4).");
      break;
    }
    if (previous && current.total_points > previous.total_points) {
      error(`Rank ${current.final_rank} has more total points than the preceding rank. Check the final places.`);
      break;
    }
  }
  const tiedTotals = new Set(entries.filter((entry, index) => index > 0 && entry.total_points === entries[index - 1].total_points).map((entry) => entry.total_points));
  if (tiedTotals.size) {
    warnings.push("Some season totals are tied. The listed final ranks will be saved exactly as previewed; confirm these are the league’s official resolved places.");
    const mismatches: string[] = [];
    for (let index = 1; index < entries.length; index += 1) {
      const previous = entries[index - 1];
      const current = entries[index];
      if (current.total_points !== previous.total_points) continue;
      const left = raceScores.get(previous) ?? [];
      const right = raceScores.get(current) ?? [];
      if (!left.length || !right.length) continue;
      const latest = right[right.length - 1] - left[left.length - 1];
      const penultimate = (right[right.length - 2] ?? 0) - (left[left.length - 2] ?? 0);
      if (latest > 0 || (latest === 0 && penultimate > 0)) mismatches.push(`${current.team_name} / ${previous.team_name}`);
    }
    if (mismatches.length) warnings.push(`The final-race / second-to-last-race rule would put these pairs in a different order (last score column treated as the final race): ${mismatches.slice(0, 5).join("; ")}${mismatches.length > 5 ? "; more pairs also differ" : ""}. Correct the source ranks first if that rule applies to this historical season.`);
  }
  result.verifiedRaceScores = errors.length === 0 && scoreIndexes.length > 0;
  return result;
}

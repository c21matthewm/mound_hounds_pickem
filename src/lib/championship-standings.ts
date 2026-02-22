export type ParsedChampionshipStandingRow = {
  driverName: string;
  lineNumber: number;
  points: number;
  rank: number;
};

export type ParsedChampionshipStandings = {
  ignoredLineCount: number;
  rows: ParsedChampionshipStandingRow[];
};

const splitColumns = (line: string): string[] => {
  if (line.includes("\t")) {
    return line.split("\t").map((cell) => cell.trim()).filter(Boolean);
  }

  if (line.includes("|")) {
    return line.split("|").map((cell) => cell.trim()).filter(Boolean);
  }

  return line.split(/\s{2,}/).map((cell) => cell.trim()).filter(Boolean);
};

const parseInteger = (value: string): number | null => {
  const normalized = value.replace(/,/g, "");
  const match = normalized.match(/-?\d+/);
  if (!match) {
    return null;
  }

  const parsed = Number.parseInt(match[0], 10);
  return Number.isInteger(parsed) ? parsed : null;
};

const isLikelyHeader = (line: string): boolean => {
  const lower = line.toLowerCase();
  return lower.includes("rank") && lower.includes("driver") && lower.includes("points");
};

export function parseChampionshipStandingsPaste(rawInput: string): ParsedChampionshipStandings {
  const lines = rawInput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const rows: ParsedChampionshipStandingRow[] = [];
  let ignoredLineCount = 0;

  lines.forEach((line, index) => {
    if (isLikelyHeader(line)) {
      ignoredLineCount += 1;
      return;
    }

    const columns = splitColumns(line);
    if (columns.length < 4) {
      ignoredLineCount += 1;
      return;
    }

    const rank = parseInteger(columns[0] ?? "");
    const driverName = (columns[1] ?? "").trim();
    const points = parseInteger(columns[3] ?? "");

    if (!rank || rank <= 0 || !driverName || points === null || points < 0) {
      ignoredLineCount += 1;
      return;
    }

    rows.push({
      driverName,
      lineNumber: index + 1,
      points,
      rank
    });
  });

  return {
    ignoredLineCount,
    rows
  };
}

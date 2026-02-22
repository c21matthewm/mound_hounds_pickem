export type ParsedIndycarResultRow = {
  carNumber: string | null;
  driverName: string;
  lineNumber: number;
  points: number;
  position: number | null;
};

export type ParsedIndycarResults = {
  ignoredLineCount: number;
  rows: ParsedIndycarResultRow[];
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
  const match = value.match(/-?\d+/);
  if (!match) return null;

  const parsed = Number.parseInt(match[0], 10);
  return Number.isInteger(parsed) ? parsed : null;
};

const isLikelyHeader = (line: string): boolean => {
  const lower = line.toLowerCase();
  return lower.includes("pos") && lower.includes("driver") && lower.includes("points");
};

const isCarNumber = (value: string): boolean => /^\d{1,3}$/.test(value.trim());

const extractDriverAndCar = (
  driverCell: string,
  carCandidate: string | null
): { carNumber: string | null; driverName: string | null } => {
  if (!driverCell) {
    return { carNumber: null, driverName: null };
  }

  if (carCandidate && isCarNumber(carCandidate)) {
    return { carNumber: carCandidate, driverName: driverCell.trim() };
  }

  const combined = driverCell.match(/^(\d{1,3})\s+(.+)$/);
  if (combined) {
    return { carNumber: combined[1], driverName: combined[2].trim() };
  }

  return { carNumber: null, driverName: driverCell.trim() };
};

export function normalizeDriverName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^\d+\s+/, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

export function parseIndycarResultsPaste(rawInput: string): ParsedIndycarResults {
  const lines = rawInput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const rows: ParsedIndycarResultRow[] = [];
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

    const points = parseInteger(columns[columns.length - 1] ?? "");
    if (points === null) {
      ignoredLineCount += 1;
      return;
    }

    const position = parseInteger(columns[0] ?? "");

    const driverIndexFromEnd = columns.length - 9;
    const driverIndex = driverIndexFromEnd >= 0 ? driverIndexFromEnd : 2;
    const driverCell = columns[driverIndex] ?? "";
    const carCandidate = driverIndex > 0 ? columns[driverIndex - 1] ?? null : null;

    const { carNumber, driverName } = extractDriverAndCar(driverCell, carCandidate);

    if (!driverName) {
      ignoredLineCount += 1;
      return;
    }

    rows.push({
      carNumber,
      driverName,
      lineNumber: index + 1,
      points,
      position
    });
  });

  return {
    ignoredLineCount,
    rows
  };
}

import { INDY_500_QUALIFYING_FIELD_SIZE } from "@/lib/race-format";

export type ParsedQualifyingOrderRow = {
  carNumber: string | null;
  driverName: string;
  lineNumber: number;
  position: number;
};

export type ParsedQualifyingOrder = {
  ignoredLineCount: number;
  rows: ParsedQualifyingOrderRow[];
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
  if (!match) {
    return null;
  }

  const parsed = Number.parseInt(match[0], 10);
  return Number.isInteger(parsed) ? parsed : null;
};

const isLikelyHeader = (line: string): boolean => {
  const lower = line.toLowerCase();
  return (
    (lower.includes("pos") || lower.includes("rank") || lower.includes("starting")) &&
    lower.includes("driver")
  );
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

const parseLooseLine = (line: string): ParsedQualifyingOrderRow | null => {
  const match = line.match(/^(\d{1,2})\s+(?:(\d{1,3})\s+)?(.+)$/);
  if (!match) {
    return null;
  }

  const position = parseInteger(match[1]);
  const driverName = match[3]?.trim();
  if (!position || position < 1 || position > INDY_500_QUALIFYING_FIELD_SIZE || !driverName) {
    return null;
  }

  return {
    carNumber: match[2] ?? null,
    driverName,
    lineNumber: 0,
    position
  };
};

export function parseQualifyingOrderPaste(rawInput: string): ParsedQualifyingOrder {
  const lines = rawInput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const rows: ParsedQualifyingOrderRow[] = [];
  let ignoredLineCount = 0;

  lines.forEach((line, index) => {
    if (isLikelyHeader(line)) {
      ignoredLineCount += 1;
      return;
    }

    const columns = splitColumns(line);
    if (columns.length >= 2) {
      const position = parseInteger(columns[0] ?? "");
      if (position && position >= 1 && position <= INDY_500_QUALIFYING_FIELD_SIZE) {
        const carCandidate = columns[1] ?? null;
        const driverCell = isCarNumber(carCandidate ?? "") ? (columns[2] ?? "") : (columns[1] ?? "");
        const { carNumber, driverName } = extractDriverAndCar(driverCell, carCandidate);

        if (driverName) {
          rows.push({
            carNumber,
            driverName,
            lineNumber: index + 1,
            position
          });
          return;
        }
      }
    }

    const looseRow = parseLooseLine(line);
    if (looseRow) {
      rows.push({
        ...looseRow,
        lineNumber: index + 1
      });
      return;
    }

    ignoredLineCount += 1;
  });

  return {
    ignoredLineCount,
    rows
  };
}

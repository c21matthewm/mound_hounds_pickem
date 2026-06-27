export type SortDirection = "asc" | "desc";

export const sortIndicator = <T extends string>(
  key: T,
  activeKey: T,
  direction: SortDirection
): string => {
  if (key !== activeKey) {
    return "↕";
  }

  return direction === "asc" ? "↑" : "↓";
};

export const compareNullableNumber = (
  a: number | null,
  b: number | null,
  direction: SortDirection
): number => {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return direction === "asc" ? a - b : b - a;
};

export const compareText = (a: string, b: string, direction: SortDirection): number =>
  direction === "asc" ? a.localeCompare(b) : b.localeCompare(a);

export const textMatch = (value: string, filterValue: string): boolean => {
  const normalizedFilter = filterValue.trim().toLowerCase();
  if (!normalizedFilter) {
    return true;
  }

  return value.toLowerCase().includes(normalizedFilter);
};

export const numericMatch = (value: number | null, filterValue: string): boolean => {
  const normalizedFilter = filterValue.trim();
  if (!normalizedFilter) {
    return true;
  }
  if (value === null) {
    return false;
  }

  const compareMatch = normalizedFilter.match(/^(<=|>=|<|>)\s*(-?\d+(?:\.\d+)?)$/);
  if (compareMatch) {
    const operator = compareMatch[1];
    const threshold = Number(compareMatch[2]);
    if (operator === "<") return value < threshold;
    if (operator === "<=") return value <= threshold;
    if (operator === ">") return value > threshold;
    if (operator === ">=") return value >= threshold;
  }

  const rangeMatch = normalizedFilter.match(/^(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)$/);
  if (rangeMatch) {
    const left = Number(rangeMatch[1]);
    const right = Number(rangeMatch[2]);
    const min = Math.min(left, right);
    const max = Math.max(left, right);
    return value >= min && value <= max;
  }

  const exact = Number(normalizedFilter);
  if (!Number.isNaN(exact)) {
    return value === exact;
  }

  return String(value).includes(normalizedFilter);
};

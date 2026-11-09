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

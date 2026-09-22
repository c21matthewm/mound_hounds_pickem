export type DriverRosterSelection = { id: number; expected_is_active: boolean };
export function parseDriverRosterSelection(input: string): DriverRosterSelection[] {
  if (input.length > 20_000) throw new Error("Choose at most 100 drivers.");
  const rows: unknown = JSON.parse(input);
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 100) throw new Error("Choose between 1 and 100 drivers.");
  const ids = new Set<number>();
  return rows.map(row => {
    if (!row || typeof row !== "object" || !Number.isSafeInteger(row.id) || row.id <= 0 || row.id > 999999999999999 || typeof row.expected_is_active !== "boolean" || ids.has(row.id)) throw new Error("Select each valid driver only once.");
    ids.add(row.id);
    return {id:row.id,expected_is_active:row.expected_is_active};
  });
}

import { normalizeDriverName, type ParsedIndycarResults } from "@/lib/indycar-results";
import {
  groupNumbersForCount, INDY_500_QUALIFYING_FIELD_SIZE, isValidAverageSpeedMph,
  normalizeRacePickFormat, pickGroupCountForFormat, type RacePickFormat
} from "@/lib/race-format";
import { buildRaceScoringProjection } from "@/lib/race-scoring-model";

export const MAX_STANDARD_NONSTARTERS = 5;
export type RaceResultsPreviewDriver = {
  aliases?: readonly string[];
  driverName: string;
  groupNumber: number;
  id: number;
  isActive: boolean;
};
export type RaceResultsPreviewGroup = {
  driver_id: number;
  group_number: number;
  qualifying_position?: number | null;
  race_id: number;
};
export type RaceResultsPreviewFlag = {
  blocksManualPublish: boolean;
  code: string;
  message: string;
};
export type RaceResultsPreviewRow = {
  groupNumber: number | null;
  lineNumber: number;
  mappedDriverId: number | null;
  mappedDriverName: string | null;
  points: number;
  position: number | null;
  sourceDriverName: string;
  status: "duplicate" | "ready" | "unmatched";
};
export type RaceResultsPreview = {
  canPublishManually: boolean;
  duplicateCount: number;
  expectedResultCount: number;
  flags: RaceResultsPreviewFlag[];
  groupCount: number;
  hasRaceFieldSnapshot: boolean;
  highestPossibleScore: number | null;
  ignoredLineCount: number;
  isClean: boolean;
  lowestPossibleScore: number | null;
  missingOfficialGroups: number[];
  missingScoreGroups: number[];
  parsedRowCount: number;
  positionsValid: boolean;
  publishRows: Array<{ driver_id: number; points: number; position: number | null }>;
  readyCount: number;
  rows: RaceResultsPreviewRow[];
  unmatchedDriverNames: string[];
  unmatchedLineCount: number;
  winningAverageSpeed: number | null;
  zeroPointDriverNames: string[];
};
type PreviewInput = {
  drivers: readonly RaceResultsPreviewDriver[];
  fieldFrozen?: boolean;
  parsed: ParsedIndycarResults;
  pickFormat: RacePickFormat;
  raceDriverGroups: readonly RaceResultsPreviewGroup[];
  raceId: number;
};

/** Canonical mapping for manual previews, server validation, and staging.
 * Review flags retain manual nonstarter behavior; every flag blocks automation.
 * This service never writes or changes the shared scoring rules.
 */
export function buildRaceResultsPreview({ drivers, fieldFrozen, parsed, pickFormat, raceDriverGroups, raceId }: PreviewInput): RaceResultsPreview {
  const format = normalizeRacePickFormat(pickFormat);
  const groupCount = pickGroupCountForFormat(format);
  const groupNumbers = groupNumbersForCount(groupCount);
  const flags: RaceResultsPreviewFlag[] = [];
  const flag = (code: string, message: string, blocksManualPublish = true) => {
    flags.push({ blocksManualPublish, code, message });
  };
  const driverById = new Map(drivers.map(driver => [driver.id, driver]));
  const driverIdsByName = new Map<string, Set<number>>();
  for (const driver of drivers) {
    for (const name of [driver.driverName, ...(driver.aliases ?? [])]) {
      const normalized = normalizeDriverName(name);
      if (!normalized) continue;
      const ids = driverIdsByName.get(normalized) ?? new Set<number>();
      ids.add(driver.id);
      driverIdsByName.set(normalized, ids);
    }
  }
  const raceGroups = raceDriverGroups.filter(group => group.race_id === raceId);
  const raceGroupByDriverId = new Map(raceGroups.map(group => [group.driver_id, group.group_number]));
  const hasRaceFieldSnapshot = raceGroupByDriverId.size > 0;
  const expectedDriverIds = hasRaceFieldSnapshot
    ? new Set(raceGroupByDriverId.keys())
    : new Set(format === "standard"
      ? drivers.filter(driver => driver.isActive && groupNumbers.includes(driver.groupNumber)).map(driver => driver.id)
      : []);
  if (!hasRaceFieldSnapshot) {
    flag("missing_field_snapshot", "The race does not have a saved driver-group field. Freeze and verify the field before automated publication.", false);
  }
  if (fieldFrozen === false) flag("field_not_frozen", "The race field has not been frozen for this race.", false);
  if (raceGroups.some(group => !groupNumbers.includes(group.group_number))) {
    flag("invalid_field_group", "The saved race field contains an invalid pick group.");
  }
  if (raceGroups.some(group => raceGroupByDriverId.get(group.driver_id) !== group.group_number)) {
    flag("conflicting_field_group", "The saved race field assigns a driver to more than one group.");
  }
  if (format === "indy_500" && expectedDriverIds.size !== INDY_500_QUALIFYING_FIELD_SIZE) {
    flag("incomplete_qualifying_field", `Indianapolis 500 results require a saved ${INDY_500_QUALIFYING_FIELD_SIZE}-car qualifying field.`);
  }
  if (parsed.ignoredLineCount > 0) {
    flag("ignored_source_lines", `${parsed.ignoredLineCount} non-data source line(s) were ignored. Review the source before automated publication.`, false);
  }
  const seenDriverIds = new Set<number>();
  const unmatchedNames = new Set<string>();
  const resolveGroup = (driverId: number) => raceGroupByDriverId.get(driverId) ??
    (format === "standard" ? driverById.get(driverId)?.groupNumber ?? null : null);
  const rows: RaceResultsPreviewRow[] = parsed.rows.map(row => {
    const ids = driverIdsByName.get(normalizeDriverName(row.driverName));
    const matchedId = ids?.size === 1 ? [...ids][0] : null;
    const matched = matchedId === null ? undefined : driverById.get(matchedId);
    const base = {
      groupNumber: matched ? resolveGroup(matched.id) : null,
      lineNumber: row.lineNumber,
      mappedDriverId: matched?.id ?? null,
      mappedDriverName: matched?.driverName ?? null,
      points: row.points, position: row.position, sourceDriverName: row.driverName
    };
    if (!matched) {
      const ambiguous = ids !== undefined && ids.size > 1;
      unmatchedNames.add(`${row.driverName}${ambiguous ? " (ambiguous name)" : ""}`);
      flag(ambiguous ? "ambiguous_driver_name" : "unmapped_driver", `${ambiguous ? "Ambiguous driver name" : "Unmapped driver"}: ${row.driverName}.`);
      return { ...base, status: "unmatched" };
    }
    if (!expectedDriverIds.has(matched.id)) {
      unmatchedNames.add(`${row.driverName} (outside race field)`);
      flag("driver_outside_field", `Driver outside the saved race field: ${row.driverName}.`);
      return { ...base, groupNumber: null, status: "unmatched" };
    }
    if (seenDriverIds.has(matched.id)) {
      flag("duplicate_driver", `Duplicate result row for: ${matched.driverName}.`);
      return { ...base, status: "duplicate" };
    }
    seenDriverIds.add(matched.id);
    if (!Number.isInteger(row.points) || row.points < 0) {
      flag("invalid_points", `Non-negative integer points are required for ${matched.driverName}.`);
    }
    return { ...base, status: "ready" };
  });
  const readyRows = rows.filter(row => row.status === "ready");
  const readyCount = readyRows.length;
  const sortedPositions = readyRows.map(row => row.position)
    .filter((position): position is number => position !== null && Number.isInteger(position)).sort((a, b) => a - b);
  const positionsValid = readyCount > 0 && sortedPositions.length === readyCount &&
    new Set(sortedPositions).size === readyCount && sortedPositions.every((position, index) => position === index + 1);
  if (!positionsValid) flag("invalid_positions", `Official finishing positions must be unique and contiguous from 1 through ${readyCount}.`);
  if (readyCount === 0 || readyCount > expectedDriverIds.size) {
    flag("invalid_field_size", `Expected 1-${expectedDriverIds.size} mapped official result rows, got ${readyCount}.`);
  }
  const zeroPointDriverIds = [...expectedDriverIds].filter(id => !seenDriverIds.has(id));
  const zeroPointDriverNames = zeroPointDriverIds.map(id => driverById.get(id)?.driverName ?? `Driver #${id}`).sort((a, b) => a.localeCompare(b));
  if (zeroPointDriverIds.length > 0) {
    flag("missing_field_drivers", `Missing ${zeroPointDriverIds.length} saved-field driver(s): ${zeroPointDriverNames.join(", ")}.`,
      format === "indy_500" || zeroPointDriverIds.length > MAX_STANDARD_NONSTARTERS);
  }
  const officialResultGroups = new Set(readyRows.map(row => row.groupNumber).filter((group): group is number => group !== null));
  const missingOfficialGroups = groupNumbers.filter(group => !officialResultGroups.has(group));
  if (missingOfficialGroups.length > 0) flag("missing_official_groups", `The official order has no participating driver from group(s): ${missingOfficialGroups.join(", ")}.`);
  const winningAverageSpeed = parsed.winningAverageSpeed !== null && isValidAverageSpeedMph(parsed.winningAverageSpeed) ? parsed.winningAverageSpeed : null;
  if (winningAverageSpeed === null) flag("missing_winning_speed", "Could not read the winning driver's average speed. Include exactly one first-place row with an Average Speed greater than 0 and no more than 300 MPH.");
  const scoringProjection = buildRaceScoringProjection({
    currentDrivers: drivers.map(driver => ({ group_number: driver.groupNumber, id: driver.id })),
    officialWinningAverageSpeed: winningAverageSpeed, participants: [], pickFormat: format, picks: [], raceDriverGroups: raceGroups,
    results: [
      ...readyRows.flatMap(row => row.mappedDriverId === null || !Number.isInteger(row.points) || row.points < 0 ? [] : [{ driver_id: row.mappedDriverId, points: row.points }]),
      ...zeroPointDriverIds.map(id => ({ driver_id: id, points: 0 }))
    ]
  });
  const missingScoreGroups = groupNumbers.filter(group => !scoringProjection.minimumPointsByGroup.has(group));
  if (missingScoreGroups.length > 0) flag("missing_scoring_groups", `Highest/lowest possible scores require results in group(s): ${missingScoreGroups.join(", ")}.`);
  const canPublishManually = !flags.some(item => item.blocksManualPublish);
  return {
    canPublishManually, duplicateCount: rows.filter(row => row.status === "duplicate").length,
    expectedResultCount: expectedDriverIds.size, flags, groupCount, hasRaceFieldSnapshot,
    highestPossibleScore: missingScoreGroups.length > 0 ? null : scoringProjection.highestPossibleScore,
    ignoredLineCount: parsed.ignoredLineCount,
    isClean: canPublishManually && hasRaceFieldSnapshot && readyCount === expectedDriverIds.size && flags.length === 0,
    lowestPossibleScore: missingScoreGroups.length > 0 ? null : scoringProjection.lowestPossibleScore,
    missingOfficialGroups, missingScoreGroups, parsedRowCount: parsed.rows.length, positionsValid,
    publishRows: readyRows.flatMap(row => row.mappedDriverId === null ? [] : [{ driver_id: row.mappedDriverId, points: row.points, position: row.position }]),
    readyCount, rows, unmatchedDriverNames: [...unmatchedNames],
    unmatchedLineCount: rows.filter(row => row.status === "unmatched").length,
    winningAverageSpeed, zeroPointDriverNames
  };
}

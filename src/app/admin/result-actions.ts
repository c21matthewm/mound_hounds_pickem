"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin";
import { recordAdminAudit } from "@/lib/admin-audit";
import { normalizeDriverName, parseIndycarResultsPaste } from "@/lib/indycar-results";
import { parseQualifyingOrderPaste } from "@/lib/qualifying-order";
import {
  INDY_500_QUALIFYING_FIELD_SIZE,
  indy500GroupForQualifyingPosition,
  isValidAverageSpeedMph,
  normalizeRacePickFormat
} from "@/lib/race-format";
import { withMigrationHint } from "@/lib/supabase/migration-errors";
import {
  OPERATIONS_HARDENING_MIGRATION_FILE,
  type RaceStatusRow,
  adminMutationRedirect,
  asText,
  createPublishedRaceCheckpoint,
  createSeasonSafetySnapshot,
  ensureRaceIsActive,
  fantasyWinnerPublicationMessage,
  finalizePublishedRaceWinner,
  parseAdminTab,
  parseNonNegativeNumber,
  parsePositiveInteger,
  reportAdminActionFailure,
  withResultPublicationMigrationHint
} from "@/app/admin/action-runtime";

const reportResultFailure = ({
  code,
  error,
  fallback,
  operation,
  raceId,
  resultRaceId,
  userId
}: {
  code: string;
  error: unknown;
  fallback: string;
  operation: string;
  raceId?: number | null;
  resultRaceId?: number | null;
  userId: string;
}) =>
  reportAdminActionFailure({
    actorProfileId: userId,
    code,
    context: { entityId: raceId, entityType: "race", operation, raceId },
    error,
    fallback,
    resultRaceId,
    tab: "results"
  });

export async function importIndy500QualifyingOrderAction(formData: FormData) {
  const { supabase, user } = await requireAdmin();
  const tab = parseAdminTab(asText(formData.get("tab"))) ?? "results";
  const resultRaceId = parsePositiveInteger(asText(formData.get("result_race_id")));
  const redirectWithTab = (key: "error" | "message", value: string): never =>
    adminMutationRedirect(key, value, tab, resultRaceId);

  const raceIdInput = parsePositiveInteger(asText(formData.get("race_id")));
  const rawPaste = asText(formData.get("qualifying_order_paste"));

  if (raceIdInput === null) {
    redirectWithTab("error", "Select an Indianapolis 500 race before importing qualifying order.");
  }
  const raceId = raceIdInput as number;

  const { data: race, error: raceError } = await supabase
    .from("races")
    .select("id,race_name,is_archived,pick_format")
    .eq("id", raceId)
    .maybeSingle<RaceStatusRow & { race_name: string }>();

  if (raceError) {
    await reportResultFailure({
      code: "load-qualifying-race-failed",
      error: raceError,
      fallback: "The Indianapolis 500 race could not be loaded.",
      operation: "import_qualifying",
      raceId,
      resultRaceId,
      userId: user.id
    });
  }
  if (!race) {
    redirectWithTab("error", "Selected race was not found.");
  }
  const selectedRace = race as RaceStatusRow & { race_name: string };

  if (selectedRace.is_archived) {
    redirectWithTab("error", "Selected race is archived. Unarchive it before importing qualifying order.");
  }
  if (normalizeRacePickFormat(selectedRace.pick_format) !== "indy_500") {
    redirectWithTab("error", "Qualifying order upload is only available for races marked Indianapolis 500.");
  }

  if (!rawPaste) {
    redirectWithTab("error", "Paste the 33-car Indianapolis 500 qualifying order before importing.");
  }

  const parsed = parseQualifyingOrderPaste(rawPaste);
  if (parsed.rows.length === 0) {
    redirectWithTab("error", "No qualifying order rows were detected.");
  }

  const rowsByPosition = new Map<number, (typeof parsed.rows)[number]>();
  const duplicatePositions = new Set<number>();
  parsed.rows.forEach((row) => {
    if (rowsByPosition.has(row.position)) {
      duplicatePositions.add(row.position);
      return;
    }
    rowsByPosition.set(row.position, row);
  });

  if (duplicatePositions.size > 0) {
    redirectWithTab(
      "error",
      `Duplicate qualifying position(s): ${Array.from(duplicatePositions).sort((a, b) => a - b).join(", ")}`
    );
  }

  const missingPositions: number[] = [];
  for (let position = 1; position <= INDY_500_QUALIFYING_FIELD_SIZE; position += 1) {
    if (!rowsByPosition.has(position)) {
      missingPositions.push(position);
    }
  }

  if (missingPositions.length > 0 || rowsByPosition.size !== INDY_500_QUALIFYING_FIELD_SIZE) {
    redirectWithTab(
      "error",
      `Indianapolis 500 qualifying order must include positions 1-${INDY_500_QUALIFYING_FIELD_SIZE}. Missing: ${missingPositions.join(", ") || "none"}.`
    );
  }

  const { data: drivers, error: driversError } = await supabase
    .from("drivers")
    .select("id,driver_name");

  if (driversError) {
    await reportResultFailure({
      code: "load-qualifying-drivers-failed",
      error: driversError,
      fallback: "The driver roster could not be loaded.",
      operation: "import_qualifying",
      raceId,
      resultRaceId,
      userId: user.id
    });
  }

  const driverMap = new Map<string, { id: number; name: string }>();
  (drivers ?? []).forEach((driver) => {
    driverMap.set(normalizeDriverName(driver.driver_name), {
      id: driver.id,
      name: driver.driver_name
    });
  });

  const unmatchedNames = new Set<string>();
  const duplicateDriverNames = new Set<string>();
  const seenDriverIds = new Set<number>();
  const payload: Array<{
    driver_id: number;
    group_number: number;
    qualifying_position: number;
    race_id: number;
  }> = [];

  Array.from(rowsByPosition.values())
    .sort((a, b) => a.position - b.position)
    .forEach((row) => {
      const match = driverMap.get(normalizeDriverName(row.driverName));
      if (!match) {
        unmatchedNames.add(row.driverName);
        return;
      }
      if (seenDriverIds.has(match.id)) {
        duplicateDriverNames.add(match.name);
        return;
      }

      const groupNumber = indy500GroupForQualifyingPosition(row.position);
      if (!groupNumber) {
        return;
      }

      seenDriverIds.add(match.id);
      payload.push({
        driver_id: match.id,
        group_number: groupNumber,
        qualifying_position: row.position,
        race_id: raceId
      });
    });

  if (unmatchedNames.size > 0) {
    redirectWithTab(
      "error",
      `Could not match these qualifying drivers in your database: ${Array.from(unmatchedNames).join(", ")}`
    );
  }

  if (duplicateDriverNames.size > 0) {
    redirectWithTab(
      "error",
      `Duplicate driver(s) in qualifying order: ${Array.from(duplicateDriverNames).join(", ")}`
    );
  }

  if (payload.length !== INDY_500_QUALIFYING_FIELD_SIZE) {
    redirectWithTab(
      "error",
      `Expected ${INDY_500_QUALIFYING_FIELD_SIZE} matched qualifying rows, got ${payload.length}.`
    );
  }

  const { error: replaceError } = await supabase.rpc(
    "replace_indy_500_qualifying_order",
    {
      p_race_id: raceId,
      p_rows: payload.map(({ driver_id, group_number, qualifying_position }) => ({
        driver_id,
        group_number,
        qualifying_position
      }))
    }
  );

  if (replaceError) {
    await reportResultFailure({
      code: "replace-qualifying-order-failed",
      error: withMigrationHint(replaceError.message, OPERATIONS_HARDENING_MIGRATION_FILE),
      fallback: "The qualifying order could not be imported.",
      operation: "import_qualifying",
      raceId,
      resultRaceId,
      userId: user.id
    });
  }

  revalidatePath("/admin");
  revalidatePath("/picks");
  revalidatePath("/leaderboard");

  const ignoredSummary =
    parsed.ignoredLineCount > 0 ? ` ${parsed.ignoredLineCount} line(s) ignored.` : "";
  redirectWithTab(
    "message",
    `Imported Indianapolis 500 qualifying order for ${selectedRace.race_name}: ${payload.length} drivers across 8 groups.${ignoredSummary}`
  );
}

export async function upsertResultAction(formData: FormData) {
  const { supabase, user } = await requireAdmin();
  const tab = parseAdminTab(asText(formData.get("tab"))) ?? "results";
  const resultRaceId = parsePositiveInteger(asText(formData.get("result_race_id")));
  const redirectWithTab = (key: "error" | "message", value: string): never =>
    adminMutationRedirect(key, value, tab, resultRaceId);

  const raceId = parsePositiveInteger(asText(formData.get("race_id")));
  const driverId = parsePositiveInteger(asText(formData.get("driver_id")));
  const points = parseNonNegativeNumber(asText(formData.get("points")));
  const confirmResultsCorrection =
    asText(formData.get("confirm_results_correction")) === "on";

  if (!raceId || !driverId || points === null || !Number.isInteger(points)) {
    redirectWithTab("error", "Race, driver, and non-negative integer points are required.");
  }
  const selectedRaceId = raceId as number;
  const selectedDriverId = driverId as number;

  try {
    await ensureRaceIsActive(supabase, selectedRaceId);
  } catch (ensureError) {
    const message =
      ensureError instanceof Error ? ensureError.message : "Selected race is not editable.";
    redirectWithTab("error", message);
  }

  const { data: selectedRace, error: selectedRaceError } = await supabase
    .from("races")
    .select("race_name,results_status,round_number,season_id")
    .eq("id", selectedRaceId)
    .maybeSingle<{
      race_name: string;
      results_status: "draft" | "published";
      round_number: number;
      season_id: number;
    }>();
  if (selectedRaceError) {
    await reportResultFailure({
      code: "load-result-race-failed",
      error: selectedRaceError,
      fallback: "The selected race could not be loaded.",
      operation: "save_result_draft",
      raceId: selectedRaceId,
      resultRaceId,
      userId: user.id
    });
  }
  if (!selectedRace) {
    redirectWithTab("error", "Selected race was not found.");
  }
  const resultRace = selectedRace!;
  if (resultRace.results_status === "published" && !confirmResultsCorrection) {
    redirectWithTab(
      "error",
      "Published results require the correction confirmation before they can return to draft."
    );
  }
  if (resultRace.results_status === "published") {
    try {
      await createSeasonSafetySnapshot(
        supabase,
        resultRace.season_id,
        `Before correcting R${resultRace.round_number}: ${resultRace.race_name}`,
        "pre_correction",
        `race:${selectedRaceId}`
      );
    } catch (snapshotError) {
      await reportResultFailure({
        code: "result-correction-backup-failed",
        error: snapshotError,
        fallback: "Could not create the required pre-correction backup.",
        operation: "save_result_draft",
        raceId: selectedRaceId,
        resultRaceId,
        userId: user.id
      });
    }
  }

  const { error } = await supabase.rpc("save_race_result_draft", {
    p_driver_id: selectedDriverId,
    p_points: points,
    p_race_id: selectedRaceId
  });

  if (error) {
    await reportResultFailure({
      code: "save-result-draft-failed",
      error: withResultPublicationMigrationHint(error.message),
      fallback: "The draft result could not be saved.",
      operation: "save_result_draft",
      raceId: selectedRaceId,
      resultRaceId,
      userId: user.id
    });
  }

  await recordAdminAudit(supabase, {
    action:
      resultRace.results_status === "published"
        ? "begin_results_correction"
        : "save_result_draft",
    afterState: { driver_id: selectedDriverId, points },
    entityId: String(selectedRaceId),
    entityType: "race",
    summary:
      resultRace.results_status === "published"
        ? `Returned ${resultRace.race_name} to draft for a result correction.`
        : `Saved a draft result for ${resultRace.race_name}.`
  });

  revalidatePath("/admin");
  revalidatePath("/leaderboard");
  revalidatePath("/picks");

  const [raceNameRes, driverNameRes, raceResultCountRes] = await Promise.all([
    supabase.from("races").select("race_name").eq("id", selectedRaceId).maybeSingle(),
    supabase.from("drivers").select("driver_name").eq("id", selectedDriverId).maybeSingle(),
    supabase
      .from("results")
      .select("id", { count: "exact", head: true })
      .eq("race_id", selectedRaceId)
  ]);

  const raceName =
    raceNameRes.error || !raceNameRes.data
      ? `Race #${selectedRaceId}`
      : raceNameRes.data.race_name;
  const driverName =
    driverNameRes.error || !driverNameRes.data
      ? `Driver #${selectedDriverId}`
      : driverNameRes.data.driver_name;
  const raceResultCountText =
    raceResultCountRes.error || raceResultCountRes.count === null
      ? "Current result-row count for this race could not be confirmed."
      : `${raceResultCountRes.count} result row(s) are now saved for this race.`;

  redirectWithTab(
    "message",
    `Saved ${points} draft point(s) for ${driverName} in ${raceName}. ${raceResultCountText} Draft results do not affect participant standings until the complete race is published.`
  );
}

export async function publishSavedRaceResultsAction(formData: FormData) {
  const { supabase, user } = await requireAdmin();
  const tab = parseAdminTab(asText(formData.get("tab"))) ?? "results";
  const resultRaceId = parsePositiveInteger(asText(formData.get("result_race_id")));
  const redirectWithTab = (key: "error" | "message", value: string): never =>
    adminMutationRedirect(key, value, tab, resultRaceId);

  const raceId = parsePositiveInteger(asText(formData.get("race_id")));
  const officialWinningAverageSpeed = parseNonNegativeNumber(
    asText(formData.get("official_winning_average_speed"))
  );
  const confirmResultsCorrection =
    asText(formData.get("confirm_results_correction")) === "on";

  if (
    !raceId ||
    officialWinningAverageSpeed === null ||
    !isValidAverageSpeedMph(officialWinningAverageSpeed)
  ) {
    redirectWithTab(
      "error",
      "Race and an official winning average speed between 0 and 300 MPH are required."
    );
  }
  const selectedRaceId = raceId as number;

  const { data: selectedRace, error: selectedRaceError } = await supabase
    .from("races")
    .select("race_name,results_status,round_number,season_id")
    .eq("id", selectedRaceId)
    .maybeSingle<{
      race_name: string;
      results_status: "draft" | "published";
      round_number: number;
      season_id: number;
    }>();
  if (selectedRaceError) {
    await reportResultFailure({
      code: "load-result-race-failed",
      error: selectedRaceError,
      fallback: "The selected race could not be loaded.",
      operation: "publish_saved_results",
      raceId: selectedRaceId,
      resultRaceId,
      userId: user.id
    });
  }
  if (!selectedRace) {
    redirectWithTab("error", "Selected race was not found.");
  }
  const savedResultRace = selectedRace!;
  if (savedResultRace.results_status === "published" && !confirmResultsCorrection) {
    redirectWithTab(
      "error",
      "Check the published-results correction confirmation before republishing this race."
    );
  }
  if (savedResultRace.results_status === "published") {
    try {
      await createSeasonSafetySnapshot(
        supabase,
        savedResultRace.season_id,
        `Before republishing R${savedResultRace.round_number}: ${savedResultRace.race_name}`,
        "pre_correction",
        `race:${selectedRaceId}`
      );
    } catch (snapshotError) {
      await reportResultFailure({
        code: "result-correction-backup-failed",
        error: snapshotError,
        fallback: "Could not create the required pre-correction backup.",
        operation: "publish_saved_results",
        raceId: selectedRaceId,
        resultRaceId,
        userId: user.id
      });
    }
  }

  const { data: publishedCount, error } = await supabase.rpc("publish_saved_race_results", {
    p_official_winning_average_speed: officialWinningAverageSpeed,
    p_race_id: selectedRaceId
  });

  if (error) {
    await reportResultFailure({
      code: "publish-saved-results-failed",
      error: withResultPublicationMigrationHint(error.message),
      fallback: "The saved race results could not be published.",
      operation: "publish_saved_results",
      raceId: selectedRaceId,
      resultRaceId,
      userId: user.id
    });
  }

  const winnerOutcome = await finalizePublishedRaceWinner(supabase, selectedRaceId);
  const checkpointError = await createPublishedRaceCheckpoint(
    supabase,
    {
      id: selectedRaceId,
      raceName: savedResultRace.race_name,
      roundNumber: savedResultRace.round_number,
      seasonId: savedResultRace.season_id
    },
    winnerOutcome
  );

  await recordAdminAudit(supabase, {
    action: "publish_results",
    afterState: {
      fantasy_winner_error: winnerOutcome.errorMessage,
      fantasy_winner_status: winnerOutcome.status,
      recovery_checkpoint_error: checkpointError,
      official_winning_average_speed: officialWinningAverageSpeed,
      published_result_count: Number(publishedCount ?? 0),
      winner_profile_id: winnerOutcome.winnerProfileId
    },
    entityId: String(selectedRaceId),
    entityType: "race",
    summary: `Published ${Number(publishedCount ?? 0)} saved result rows.`
  });

  revalidatePath("/admin");
  revalidatePath("/dashboard");
  revalidatePath("/leaderboard");
  revalidatePath("/picks");
  redirectWithTab(
    "message",
    `Published ${Number(publishedCount ?? 0)} saved result row(s). Driver standings and groups were refreshed. ${fantasyWinnerPublicationMessage(winnerOutcome)}${
      checkpointError ? " Create and download a manual safety backup before making another correction." : ""
    }`
  );
}

export async function importIndycarResultsAction(formData: FormData) {
  const { supabase, user } = await requireAdmin();
  const tab = parseAdminTab(asText(formData.get("tab"))) ?? "results";
  const resultRaceId = parsePositiveInteger(asText(formData.get("result_race_id")));
  const redirectWithTab = (key: "error" | "message", value: string): never =>
    adminMutationRedirect(key, value, tab, resultRaceId);

  const raceIdInput = parsePositiveInteger(asText(formData.get("race_id")));
  const rawPaste = asText(formData.get("results_paste"));
  const confirmResultsCorrection =
    asText(formData.get("confirm_results_correction")) === "on";

  if (raceIdInput === null) {
    redirectWithTab("error", "Select a race before importing pasted results.");
  }
  const raceId = raceIdInput as number;

  try {
    await ensureRaceIsActive(supabase, raceId);
  } catch (ensureError) {
    const message =
      ensureError instanceof Error ? ensureError.message : "Selected race is not editable.";
    redirectWithTab("error", message);
  }

  const { data: selectedRace, error: selectedRaceError } = await supabase
    .from("races")
    .select("race_name,results_status,round_number,season_id")
    .eq("id", raceId)
    .maybeSingle<{
      race_name: string;
      results_status: "draft" | "published";
      round_number: number;
      season_id: number;
    }>();
  if (selectedRaceError) {
    await reportResultFailure({
      code: "load-result-race-failed",
      error: selectedRaceError,
      fallback: "The selected race could not be loaded.",
      operation: "import_results",
      raceId,
      resultRaceId,
      userId: user.id
    });
  }
  if (!selectedRace) {
    redirectWithTab("error", "Selected race was not found.");
  }
  const importResultRace = selectedRace!;
  if (importResultRace.results_status === "published" && !confirmResultsCorrection) {
    redirectWithTab(
      "error",
      "Check the published-results correction confirmation before replacing this race."
    );
  }
  if (!rawPaste) {
    redirectWithTab("error", "Paste results text before importing.");
  }

  const parsed = parseIndycarResultsPaste(rawPaste);

  if (parsed.rows.length === 0) {
    redirectWithTab(
      "error",
      "No result rows were detected. Make sure you pasted the INDYCAR table rows."
    );
  }

  const { data: drivers, error: driversError } = await supabase
    .from("drivers")
    .select("id,driver_name");

  if (driversError) {
    await reportResultFailure({
      code: "load-result-drivers-failed",
      error: driversError,
      fallback: "The driver roster could not be loaded.",
      operation: "import_results",
      raceId,
      resultRaceId,
      userId: user.id
    });
  }

  const driverRows = drivers ?? [];
  const driverMap = new Map<string, { id: number; name: string }>();
  driverRows.forEach((driver) => {
    driverMap.set(normalizeDriverName(driver.driver_name), {
      id: driver.id,
      name: driver.driver_name
    });
  });

  const unmatchedNames = new Set<string>();
  const duplicateNames = new Set<string>();
  const payload: Array<{
    driver_id: number;
    points: number;
    position: number | null;
    race_id: number;
  }> = [];
  const seenDriverIds = new Set<number>();

  parsed.rows.forEach((row) => {
    const normalized = normalizeDriverName(row.driverName);
    const match = driverMap.get(normalized);

    if (!match) {
      unmatchedNames.add(row.driverName);
      return;
    }

    if (seenDriverIds.has(match.id)) {
      duplicateNames.add(match.name);
      return;
    }

    seenDriverIds.add(match.id);
    payload.push({
      driver_id: match.id,
      points: row.points,
      position: row.position,
      race_id: raceId
    });
  });

  if (unmatchedNames.size > 0) {
    redirectWithTab(
      "error",
      `Could not match these drivers in your database: ${Array.from(unmatchedNames).join(", ")}`
    );
  }

  if (duplicateNames.size > 0) {
    redirectWithTab(
      "error",
      `Duplicate result rows were found for: ${Array.from(duplicateNames).join(", ")}`
    );
  }

  if (payload.length === 0) {
    redirectWithTab("error", "No valid rows were mapped to drivers.");
  }

  const positions = payload.map((row) => row.position);
  const validPositions = positions.filter((position): position is number => position !== null);
  const sortedPositions = [...validPositions].sort((a, b) => a - b);
  const positionsAreComplete =
    validPositions.length === payload.length &&
    new Set(validPositions).size === payload.length &&
    sortedPositions.every((position, index) => position === index + 1);
  if (!positionsAreComplete) {
    redirectWithTab(
      "error",
      `Official finishing positions must be unique and contiguous from 1 through ${payload.length}.`
    );
  }

  if (
    parsed.winningAverageSpeed === null ||
    !isValidAverageSpeedMph(parsed.winningAverageSpeed)
  ) {
    redirectWithTab(
      "error",
      "Could not determine a valid official race average speed between 0 and 300 MPH. Include the Average Speed column."
    );
  }

  if (importResultRace.results_status === "published") {
    try {
      await createSeasonSafetySnapshot(
        supabase,
        importResultRace.season_id,
        `Before replacing R${importResultRace.round_number}: ${importResultRace.race_name}`,
        "pre_correction",
        `race:${raceId}`
      );
    } catch (snapshotError) {
      await reportResultFailure({
        code: "result-correction-backup-failed",
        error: snapshotError,
        fallback: "Could not create the required pre-correction backup.",
        operation: "import_results",
        raceId,
        resultRaceId,
        userId: user.id
      });
    }
  }

  const { data: publishedCount, error: publishError } = await supabase.rpc(
    "publish_race_results",
    {
      p_official_winning_average_speed: parsed.winningAverageSpeed,
      p_race_id: raceId,
      p_results: payload.map(({ driver_id, points, position }) => ({
        driver_id,
        points,
        position
      }))
    }
  );

  if (publishError) {
    await reportResultFailure({
      code: "publish-imported-results-failed",
      error: withResultPublicationMigrationHint(publishError.message),
      fallback: "The imported race results could not be published.",
      operation: "import_results",
      raceId,
      resultRaceId,
      userId: user.id
    });
  }

  const winnerOutcome = await finalizePublishedRaceWinner(supabase, raceId);
  const checkpointError = await createPublishedRaceCheckpoint(
    supabase,
    {
      id: raceId,
      raceName: importResultRace.race_name,
      roundNumber: importResultRace.round_number,
      seasonId: importResultRace.season_id
    },
    winnerOutcome
  );

  await recordAdminAudit(supabase, {
    action: "import_and_publish_results",
    afterState: {
      fantasy_winner_error: winnerOutcome.errorMessage,
      fantasy_winner_status: winnerOutcome.status,
      recovery_checkpoint_error: checkpointError,
      official_winning_average_speed: parsed.winningAverageSpeed,
      published_result_count: Number(publishedCount ?? payload.length),
      winner_profile_id: winnerOutcome.winnerProfileId
    },
    entityId: String(raceId),
    entityType: "race",
    summary: `Imported and published ${Number(publishedCount ?? payload.length)} result rows.`
  });

  revalidatePath("/admin");
  revalidatePath("/dashboard");
  revalidatePath("/leaderboard");
  revalidatePath("/picks");

  const ignoredSummary =
    parsed.ignoredLineCount > 0 ? ` ${parsed.ignoredLineCount} non-data line(s) ignored.` : "";

  const [raceNameRes, raceResultCountRes] = await Promise.all([
    supabase.from("races").select("race_name").eq("id", raceId).maybeSingle(),
    supabase
      .from("results")
      .select("id", { count: "exact", head: true })
      .eq("race_id", raceId)
  ]);

  const raceName =
    raceNameRes.error || !raceNameRes.data ? `Race #${raceId}` : raceNameRes.data.race_name;
  const raceResultCountText =
    raceResultCountRes.error || raceResultCountRes.count === null
      ? "Current result-row count for this race could not be confirmed."
      : `${raceResultCountRes.count} result row(s) are now saved for this race.`;

  redirectWithTab(
    "message",
    `Published ${Number(publishedCount ?? payload.length)} complete result row(s) for ${raceName}. ${raceResultCountText} Driver standings/groups were refreshed. ${fantasyWinnerPublicationMessage(winnerOutcome)}${
      checkpointError ? " Create and download a manual safety backup before making another correction." : ""
    }${ignoredSummary}`
  );
}

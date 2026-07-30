import path from "node:path";
import { randomUUID } from "node:crypto";
import { expect, test, type Dialog, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { trackClientIssues } from "./helpers/monitoring";
import {
  cleanupPlaywrightArtifacts,
  registerProfileForActiveSeason,
  requiredE2EEnv,
  supabase
} from "./helpers/supabase";

const LEAGUE_TIME_ZONE = "America/Indiana/Indianapolis";
const TEST_PASSWORD = "Pw-E2E-Flow-2026!";
const RUN_ID = randomUUID().slice(0, 8);
const TEST_PREFIX = `[PW E2E ${RUN_ID}]`;

type Role = "admin" | "participant";

type SeedUser = {
  email: string;
  id: string;
  role: Role;
  teamName: string;
};

type DriverSeed = {
  driver_name: string;
  group_number: number;
  id: number;
};

type RaceSeed = {
  id: number;
  is_archived: boolean;
  race_name: string;
  title_image_url: string | null;
};

type PickSelection = {
  1: number;
  2: number;
  3: number;
  4: number;
  5: number;
  6: number;
};

const toLocalInput = (value: Date): string => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone: LEAGUE_TIME_ZONE,
    year: "numeric"
  });

  const parts = new Map<string, string>();
  formatter.formatToParts(value).forEach((part) => {
    if (part.type === "year" || part.type === "month" || part.type === "day" || part.type === "hour" || part.type === "minute") {
      parts.set(part.type, part.value);
    }
  });

  const year = parts.get("year");
  const month = parts.get("month");
  const day = parts.get("day");
  const hour = parts.get("hour");
  const minute = parts.get("minute");

  if (!year || !month || !day || !hour || !minute) {
    throw new Error("Failed formatting datetime-local value.");
  }

  return `${year}-${month}-${day}T${hour}:${minute}`;
};

const signIn = async (page: Page, email: string) => {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page).not.toHaveURL(/\/login\?error=/);
};

const createSeedUser = async (label: string, role: Role): Promise<SeedUser> => {
  const email = `pw-e2e-${RUN_ID}-${label.toLowerCase()}@example.com`;
  const teamName = `${TEST_PREFIX} ${label} Team`;

  const { data: userData, error: createError } = await supabase.auth.admin.createUser({
    email,
    email_confirm: true,
    password: TEST_PASSWORD,
    user_metadata: {
      full_name: `${TEST_PREFIX} ${label} Owner`,
      team_name: teamName
    }
  });

  if (createError || !userData.user) {
    throw new Error(`Failed creating ${label} auth user: ${createError?.message ?? "unknown"}`);
  }

  const { error: profileError } = await supabase.from("profiles").upsert(
    {
      full_name: `${TEST_PREFIX} ${label} Owner`,
      id: userData.user.id,
      phone_carrier: "verizon",
      phone_number: "3175550100",
      role,
      team_name: teamName
    },
    { onConflict: "id" }
  );

  if (profileError) {
    throw new Error(`Failed upserting ${label} profile: ${profileError.message}`);
  }

  await registerProfileForActiveSeason(userData.user.id);

  return {
    email,
    id: userData.user.id,
    role,
    teamName
  };
};

const ensureDriverCoverage = async (): Promise<{
  byGroup: Map<number, DriverSeed[]>;
  createdDriverIds: number[];
}> => {
  const payload = Array.from({ length: 6 }, (_, groupIndex) =>
    Array.from({ length: 2 }, (_, driverIndex) => ({
      championship_points: 0,
      current_standing: 9000 + groupIndex * 2 + driverIndex,
      driver_name: `${TEST_PREFIX} Driver G${groupIndex + 1} #${driverIndex + 1}`,
      group_number: groupIndex + 1,
      image_url: null,
      is_active: true
    }))
  ).flat();

  const { data, error } = await supabase
    .from("drivers")
    .insert(payload)
    .select("id,driver_name,group_number");
  if (error || !data || data.length !== payload.length) {
    throw new Error(`Failed seeding isolated test drivers: ${error?.message ?? "unexpected row count"}`);
  }

  const drivers = data as DriverSeed[];
  const byGroup = new Map<number, DriverSeed[]>();
  for (let group = 1; group <= 6; group += 1) {
    byGroup.set(
      group,
      drivers.filter((driver) => driver.group_number === group)
    );
  }

  return { byGroup, createdDriverIds: drivers.map((driver) => driver.id) };
};

const getRaceByName = async (raceName: string): Promise<RaceSeed> => {
  const { data, error } = await supabase
    .from("races")
    .select("id,race_name,title_image_url,is_archived")
    .eq("race_name", raceName)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    throw new Error(`Failed loading race "${raceName}": ${error?.message ?? "not found"}`);
  }

  return data as RaceSeed;
};

const submitPicks = async (
  page: Page,
  raceName: string,
  selection: PickSelection,
  averageSpeed: number
) => {
  await page.goto("/picks");
  await expect(page.locator("main")).toContainText(raceName);
  await page.locator('input[name="average_speed"]').fill(averageSpeed.toString());

  for (const group of [1, 2, 3, 4, 5, 6] as const) {
    await page.locator(`input[name="driver_group${group}_id"][value="${selection[group]}"]`).check();
  }

  await page.getByRole("button", { name: "Save Pick'em Form" }).click();
  await expect(page.locator("main")).toContainText("Last Saved Submission");
};

const verifyUnsavedPickGuard = async (page: Page, raceName: string, groupOneDriverId: number) => {
  await page.goto("/picks");
  await expect(page.locator("main")).toContainText(raceName);
  await page.locator('input[name="average_speed"]').fill("177.001");
  await page.locator(`input[name="driver_group1_id"][value="${groupOneDriverId}"]`).check();

  const dashboardLink = page.getByRole("link", { name: "Dashboard" }).first();

  await page.evaluate(() => {
    window.confirm = () => false;
  });
  await dashboardLink.click();
  await expect(page).toHaveURL(/\/picks/);

  await page.evaluate(() => {
    window.confirm = () => true;
  });
  await dashboardLink.click();
  await expect(page).toHaveURL(/\/dashboard/);
};

test.describe.serial("Full App Flow", () => {
  const clientIssues: string[] = [];
  const findings: string[] = [];

  let adminUser: SeedUser;
  let participant1: SeedUser;
  let participant2: SeedUser;
  let participant3: SeedUser;

  test.beforeAll(async () => {
    await cleanupPlaywrightArtifacts({ recomputeDriverPoints: true });
  });

  test.afterAll(async () => {
    await cleanupPlaywrightArtifacts({ recomputeDriverPoints: true });
  });

  test("admin + participant E2E flow with race archive behavior", async ({ browser, browserName, isMobile }) => {
    test.skip(
      browserName !== "chromium" || isMobile,
      "Heavy mutation flow is limited to desktop Chromium. Cross-browser/mobile smoke is covered separately."
    );

    adminUser = await createSeedUser("Admin", "admin");
    participant1 = await createSeedUser("Participant1", "participant");
    participant2 = await createSeedUser("Participant2", "participant");
    participant3 = await createSeedUser("Participant3", "participant");

    const participantDatabaseClient = createClient(
      requiredE2EEnv("E2E_SUPABASE_URL"),
      requiredE2EEnv("E2E_SUPABASE_ANON_KEY")
    );
    const { error: participantSignInError } = await participantDatabaseClient.auth.signInWithPassword({
      email: participant1.email,
      password: TEST_PASSWORD
    });
    if (participantSignInError) {
      throw new Error(`Failed signing in participant database client: ${participantSignInError.message}`);
    }
    const { error: roleEscalationError } = await participantDatabaseClient
      .from("profiles")
      .update({ role: "admin" })
      .eq("id", participant1.id);
    expect(roleEscalationError, "Participant role escalation must be blocked by PostgreSQL.").toBeTruthy();
    const { error: activityChangeError } = await participantDatabaseClient
      .from("profiles")
      .update({ is_active: false })
      .eq("id", participant1.id);
    expect(
      activityChangeError,
      "Participants must not be able to change their own account eligibility."
    ).toBeTruthy();
    await participantDatabaseClient.auth.signOut();

    const driverCoverage = await ensureDriverCoverage();

    const pickA: PickSelection = {
      1: driverCoverage.byGroup.get(1)![0].id,
      2: driverCoverage.byGroup.get(2)![0].id,
      3: driverCoverage.byGroup.get(3)![0].id,
      4: driverCoverage.byGroup.get(4)![0].id,
      5: driverCoverage.byGroup.get(5)![0].id,
      6: driverCoverage.byGroup.get(6)![0].id
    };

    const pickB: PickSelection = {
      ...pickA,
      1: driverCoverage.byGroup.get(1)![1].id
    };

    const pickC: PickSelection = {
      1: driverCoverage.byGroup.get(1)![0].id,
      2: driverCoverage.byGroup.get(2)!.at(-1)!.id,
      3: driverCoverage.byGroup.get(3)!.at(-1)!.id,
      4: driverCoverage.byGroup.get(4)!.at(-1)!.id,
      5: driverCoverage.byGroup.get(5)!.at(-1)!.id,
      6: driverCoverage.byGroup.get(6)!.at(-1)!.id
    };

    const pickD: PickSelection = {
      1: driverCoverage.byGroup.get(1)!.at(-1)!.id,
      2: driverCoverage.byGroup.get(2)![0].id,
      3: driverCoverage.byGroup.get(3)![0].id,
      4: driverCoverage.byGroup.get(4)![0].id,
      5: driverCoverage.byGroup.get(5)![0].id,
      6: driverCoverage.byGroup.get(6)![0].id
    };

    const raceAName = `${TEST_PREFIX} Race A`;
    const raceBName = `${TEST_PREFIX} Race B`;
    const fixtureImage = path.join(process.cwd(), "tests/e2e/fixtures/race-banner.png");

    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    trackClientIssues(adminPage, "admin", clientIssues);
    await signIn(adminPage, adminUser.email);
    await adminPage.goto("/season-registration");
    await expect(adminPage).toHaveURL(/\/dashboard/);
    await adminPage.goto("/admin?tab=races");
    await expect(adminPage.locator("main")).toContainText("Admin Dashboard");

    const addRaceForm = adminPage
      .locator("form")
      .filter({ has: adminPage.getByRole("button", { name: "Add race" }) })
      .first();

    const now = new Date();
    // Keep race A as the nearest future race so the Pick'em page deterministically targets it.
    const raceAQualifying = new Date(now.getTime() + 90 * 60 * 1000);
    const raceAStart = new Date(raceAQualifying.getTime() + 3 * 60 * 60 * 1000);

    await addRaceForm.locator('input[name="race_name"]').fill(raceAName);
    await addRaceForm.locator('input[name="round_number"]').fill("90");
    await addRaceForm.locator('input[name="qualifying_start_at"]').fill(toLocalInput(raceAQualifying));
    await addRaceForm.locator('input[name="race_date"]').fill(toLocalInput(raceAStart));
    await addRaceForm.locator('input[name="payout"]').fill("150");
    await addRaceForm.locator('input[name="title_image_file"]').setInputFiles(fixtureImage);
    await addRaceForm.getByRole("button", { name: "Add race" }).click();
    await expect(adminPage.locator("main")).toContainText("Race added.");
    await expect(adminPage.locator("main")).toContainText(raceAName);

    const raceA = await getRaceByName(raceAName);
    expect(raceA.title_image_url, "Race title image URL should be saved after upload.").toBeTruthy();

    const raceASnapshot = Array.from(driverCoverage.byGroup.entries()).flatMap(
      ([groupNumber, groupDrivers]) =>
        groupDrivers.map((driver) => ({
          driver_id: driver.id,
          group_number: groupNumber,
          race_id: raceA.id
        }))
    );
    const { error: raceASnapshotError } = await supabase
      .from("race_driver_groups")
      .insert(raceASnapshot);
    if (raceASnapshotError) {
      throw new Error(`Failed seeding isolated race snapshot: ${raceASnapshotError.message}`);
    }

    await adminPage.goto("/admin?tab=races");
    const addRaceFormSecond = adminPage
      .locator("form")
      .filter({ has: adminPage.getByRole("button", { name: "Add race" }) })
      .first();

    const raceBQualifying = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
    const raceBStart = new Date(raceBQualifying.getTime() + 2 * 60 * 60 * 1000);
    await addRaceFormSecond.locator('input[name="race_name"]').fill(raceBName);
    await addRaceFormSecond.locator('input[name="round_number"]').fill("91");
    await addRaceFormSecond.locator('input[name="qualifying_start_at"]').fill(toLocalInput(raceBQualifying));
    await addRaceFormSecond.locator('input[name="race_date"]').fill(toLocalInput(raceBStart));
    await addRaceFormSecond.locator('input[name="payout"]').fill("95");
    await addRaceFormSecond.locator('input[name="title_image_file"]').setInputFiles([]);
    await addRaceFormSecond.getByRole("button", { name: "Add race" }).click();
    await expect(adminPage.locator("main")).toContainText("Race added.");
    await expect(adminPage.locator("main")).toContainText(raceBName);

    await getRaceByName(raceBName);

    const p1Context = await browser.newContext();
    const p1Page = await p1Context.newPage();
    trackClientIssues(p1Page, "participant1", clientIssues);
    await signIn(p1Page, participant1.email);
    await verifyUnsavedPickGuard(p1Page, raceAName, pickA[1]);
    await submitPicks(p1Page, raceAName, pickA, 178.101);

    let unexpectedCleanDialogMessage: string | null = null;
    const cleanDialogHandler = async (dialog: Dialog) => {
      unexpectedCleanDialogMessage = dialog.message();
      await dialog.dismiss();
    };
    p1Page.on("dialog", cleanDialogHandler);
    await p1Page.getByRole("link", { name: "Dashboard" }).first().click();
    await expect(p1Page).toHaveURL(/\/dashboard/);
    p1Page.off("dialog", cleanDialogHandler);
    expect(unexpectedCleanDialogMessage).toBeNull();

    await submitPicks(p1Page, raceAName, pickB, 178.333);

    const p2Context = await browser.newContext();
    const p2Page = await p2Context.newPage();
    trackClientIssues(p2Page, "participant2", clientIssues);
    await signIn(p2Page, participant2.email);
    await submitPicks(p2Page, raceAName, pickC, 177.812);

    const p3Context = await browser.newContext();
    const p3Page = await p3Context.newPage();
    trackClientIssues(p3Page, "participant3", clientIssues);
    await signIn(p3Page, participant3.email);
    await submitPicks(p3Page, raceAName, pickD, 179.004);

    const { data: latestP1Pick, error: latestPickError } = await supabase
      .from("picks")
      .select("driver_group1_id,average_speed")
      .eq("race_id", raceA.id)
      .eq("user_id", participant1.id)
      .maybeSingle();
    if (latestPickError || !latestP1Pick) {
      throw new Error(`Failed loading participant1 pick: ${latestPickError?.message ?? "missing row"}`);
    }
    expect(latestP1Pick.driver_group1_id).toBe(pickB[1]);

    const raceAEditDetails = adminPage.locator("details").filter({ hasText: raceAName }).first();
    await raceAEditDetails.locator("summary").click();
    const raceAEditForm = adminPage.getByTestId(`admin-race-edit-form-${raceA.id}`);
    const lockQualifying = new Date(Date.now() - 3 * 60 * 60 * 1000);
    // Standard picks lock at qualifying while the race itself remains upcoming.
    const lockRaceStart = new Date(Date.now() + 60 * 60 * 1000);
    await raceAEditForm.locator('input[name="qualifying_start_at"]').fill(toLocalInput(lockQualifying));
    await raceAEditForm.locator('input[name="race_date"]').fill(toLocalInput(lockRaceStart));
    await raceAEditForm.getByRole("button", { name: "Save" }).click();
    await expect(adminPage.locator("main")).toContainText("Race updated.");

    await p1Page.goto("/picks");
    await expect(p1Page.locator("main")).toContainText(raceAName);
    await expect(p1Page.locator("main")).toContainText("Status: Locked");
    await expect(p1Page.getByRole("button", { name: "Picks are locked" })).toBeDisabled();

    await p1Page.goto(`/leaderboard?tab=picks&race_id=${raceA.id}`);
    await expect(p1Page.locator("main")).toContainText(raceAName);
    await expect(p1Page.locator("tbody tr").filter({ hasText: participant1.teamName }).first()).toContainText("-");

    const isolatedRaceDrivers = Array.from(driverCoverage.byGroup.values()).flat();
    const zeroPointNonstarter = driverCoverage.byGroup.get(6)![1];
    const officialRaceDrivers = isolatedRaceDrivers.filter(
      (driver) => driver.id !== zeroPointNonstarter.id
    );
    const pointsByDriverId = new Map(
      isolatedRaceDrivers.map((driver, index) => [driver.id, 60 - index])
    );
    const standardPreviewPaste = [
      "Pos\tStart\tCar\tDriver\tTeam\tLaps\tLed\tStatusLaps\tTime\tAvg Speed\tStatus\tPoints",
      ...officialRaceDrivers.map((driver, index) => {
        const position = index + 1;
        const averageSpeed = (179.5 - index / 10).toFixed(3);
        return `${position}\t${position}\t${driver.id}\t${driver.driver_name}\t${TEST_PREFIX} Team\t100\t0\t0\t01:00:00\t${averageSpeed}\tRunning\t${pointsByDriverId.get(driver.id)}`;
      })
    ].join("\n");

    await adminPage.goto(`/admin?tab=results&result_race_id=${raceA.id}`);
    await adminPage.getByText("Manual result entry").click();
    const manualResultsForm = adminPage.getByTestId("admin-results-manual-form");
    const firstDraftDriver = isolatedRaceDrivers[0];
    const firstDraftPoints = pointsByDriverId.get(firstDraftDriver.id)!;
    await manualResultsForm.locator('select[name="driver_id"]').selectOption(String(firstDraftDriver.id));
    await manualResultsForm.locator('input[name="points"]').fill(String(firstDraftPoints));
    await manualResultsForm.getByRole("button", { name: "Save draft result" }).click();
    await expect(adminPage.getByTestId("admin-results-save-alert")).toContainText(
      `Saved ${firstDraftPoints} draft point(s)`
    );

    const { data: draftRace, error: draftRaceError } = await supabase
      .from("races")
      .select("results_status")
      .eq("id", raceA.id)
      .maybeSingle();
    if (draftRaceError || !draftRace) {
      throw new Error(`Failed loading draft race status: ${draftRaceError?.message ?? "missing"}`);
    }
    expect(draftRace.results_status).toBe("draft");

    const resultsImportForm = adminPage.getByTestId("admin-results-import-form");
    await expect(resultsImportForm.getByTestId("admin-results-import-race")).toContainText(raceAName);
    await resultsImportForm.getByTestId("admin-results-import-paste").fill(standardPreviewPaste);
    await resultsImportForm.getByTestId("admin-results-import-preview").click();
    await expect(resultsImportForm).toContainText(`Publish Preview: ${raceAName}`);
    await expect(resultsImportForm).toContainText("Standard format: 6 championship-standing groups.");
    await expect(resultsImportForm).toContainText("6 groups");
    await expect(resultsImportForm).toContainText("Matched Drivers");
    await expect(resultsImportForm).toContainText("Unmatched Rows");
    await expect(resultsImportForm).toContainText("Winner Avg Speed");
    await expect(resultsImportForm).toContainText("Highest Possible");
    await expect(resultsImportForm).toContainText("Lowest Possible");
    await expect(resultsImportForm).toContainText("No-Pick Users");
    await expect(resultsImportForm).toContainText("Zero-Point Nonstarters");
    await expect(resultsImportForm).toContainText(zeroPointNonstarter.driver_name);
    await expect(resultsImportForm).toContainText("Preview is clean. Ready to publish.");
    await expect(resultsImportForm.getByTestId("admin-results-import-submit")).toBeEnabled();
    await resultsImportForm.getByTestId("admin-results-import-submit").click();
    await expect(adminPage.getByTestId("admin-results-save-alert")).toContainText(
      `Published ${isolatedRaceDrivers.length} complete result row(s)`
    );

    await p1Page.goto("/leaderboard");

    const standingsTable = p1Page.getByTestId("standings-table");
    await expect(standingsTable).toContainText("R90");
    await expect(standingsTable.locator("tbody tr").filter({ hasText: participant3.teamName })).toHaveCount(1);

    const standingsTotalSort = p1Page.getByTestId("standings-sort-total");
    await standingsTotalSort.click();
    await expect(standingsTotalSort).toContainText("↓");
    await standingsTotalSort.click();
    await expect(standingsTotalSort).toContainText("↑");

    await p1Page.goto("/leaderboard?tab=analytics");
    await expect(p1Page.locator("main")).toContainText(participant1.teamName);
    await expect(p1Page.locator("main")).toContainText("Personal Analytics");
    await expect(p1Page.locator("main")).toContainText("Race Log");
    await expect(p1Page.locator("main")).toContainText("Tiebreak Read");
    await expect(p1Page.locator("main")).toContainText(raceAName);

    const { count: raceResultCount, error: raceResultCountError } = await supabase
      .from("results")
      .select("id", { count: "exact", head: true })
      .eq("race_id", raceA.id);
    if (raceResultCountError) {
      throw new Error(`Failed counting race results: ${raceResultCountError.message}`);
    }
    if ((raceResultCount ?? 0) !== isolatedRaceDrivers.length) {
      findings.push(
        `Results entry count was ${raceResultCount ?? 0} for race "${raceAName}" after publication (expected ${isolatedRaceDrivers.length}).`
      );
    }

    const { data: nonstarterResult, error: nonstarterResultError } = await supabase
      .from("results")
      .select("points")
      .eq("race_id", raceA.id)
      .eq("driver_id", zeroPointNonstarter.id)
      .maybeSingle();
    if (nonstarterResultError || !nonstarterResult) {
      throw new Error(
        `Failed loading zero-point nonstarter result: ${nonstarterResultError?.message ?? "missing row"}`
      );
    }
    expect(nonstarterResult.points).toBe(0);

    await p1Page.goto(`/leaderboard?tab=picks&race_id=${raceA.id}`);
    const p1Row = p1Page.locator("tbody tr").filter({ hasText: participant1.teamName }).first();
    await expect(p1Row).not.toContainText("-");

    await expect(
      p1Page.locator("tbody tr").filter({ hasText: participant2.teamName }).first()
    ).toBeVisible();

    const totalScoreSort = p1Page.getByTestId("picks-sort-total-score");
    await totalScoreSort.click();
    await expect(totalScoreSort).toContainText("↓");
    await totalScoreSort.click();
    await expect(totalScoreSort).toContainText("↑");

    await p2Page.goto("/feedback");
    await p2Page.locator('select[name="feedback_type"]').selectOption("improvement");
    await p2Page.locator('select[name="category"]').selectOption("user_interface");
    await p2Page
      .locator('textarea[name="details"]')
      .fill(`${TEST_PREFIX} Feedback smoke check: form submission from automated e2e test.`);
    await p2Page.getByRole("button", { name: "Submit feedback" }).click();
    await expect(p2Page.locator("main")).toContainText(
      "Thanks for the feedback. Your submission was recorded."
    );

    await adminPage.goto("/admin?tab=feedback");
    await expect(adminPage.locator("main")).toContainText(participant2.teamName);

    await adminPage.goto("/admin?tab=races");
    const raceADetailsForArchive = adminPage.locator("details").filter({ hasText: raceAName }).first();
    await raceADetailsForArchive.locator("summary").click();
    adminPage.once("dialog", (dialog) => dialog.accept());
    await raceADetailsForArchive.getByRole("button", { name: "Archive race" }).click();
    await expect(adminPage.locator("main")).toContainText("Race archived.");

    await p1Page.goto("/picks");
    await expect(p1Page.locator("main")).not.toContainText(raceAName);
    const displayedRaceTitle = (await p1Page.locator("h2").first().textContent())?.trim() ?? "";
    if (displayedRaceTitle && displayedRaceTitle !== raceBName) {
      findings.push(
        `After archiving race A, picks page advanced to "${displayedRaceTitle}" instead of this test's race B "${raceBName}" (likely due existing future races in shared data).`
      );
    }

    await adminContext.close();
    await p1Context.close();
    await p2Context.close();
    await p3Context.close();

    console.log("CLIENT_SIDE_ISSUES_START");
    if (clientIssues.length === 0) {
      console.log("none");
    } else {
      for (const issue of clientIssues) {
        console.log(issue);
      }
    }
    console.log("CLIENT_SIDE_ISSUES_END");

    console.log("TEST_FINDINGS_START");
    if (findings.length === 0) {
      console.log("none");
    } else {
      for (const finding of findings) {
        console.log(finding);
      }
    }
    console.log("TEST_FINDINGS_END");

    expect(clientIssues).toEqual([]);
  });
});

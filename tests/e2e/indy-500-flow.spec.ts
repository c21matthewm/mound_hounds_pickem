import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { trackClientIssues } from "./helpers/monitoring";
import {
  cleanupPlaywrightArtifacts,
  registerProfileForActiveSeason,
  supabase
} from "./helpers/supabase";

const LEAGUE_TIME_ZONE = "America/Indiana/Indianapolis";
const TEST_PASSWORD = "Pw-Indy-Flow-2026!";
const RUN_ID = randomUUID().slice(0, 8);
const TEST_PREFIX = `[PW INDY ${RUN_ID}]`;

type Role = "admin" | "participant";

type SeedUser = {
  email: string;
  id: string;
  teamName: string;
};

type DriverSeed = {
  driver_name: string;
  id: number;
};

type RaceSeed = {
  id: number;
  pick_format: string | null;
  race_name: string;
};

type RaceGroupSeed = {
  driver_id: number;
  group_number: number;
  qualifying_position: number | null;
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
    if (
      part.type === "year" ||
      part.type === "month" ||
      part.type === "day" ||
      part.type === "hour" ||
      part.type === "minute"
    ) {
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

const createSeedUser = async (label: string, role: Role): Promise<SeedUser> => {
  const email = `pw-indy-${RUN_ID}-${label.toLowerCase()}@example.com`;
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
    teamName
  };
};

const signIn = async (page: Page, email: string) => {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page).not.toHaveURL(/\/login\?error=/);
};

const seedIndyDrivers = async (): Promise<DriverSeed[]> => {
  const payload = Array.from({ length: 33 }, (_, index) => ({
    championship_points: 0,
    current_standing: 9600 + index,
    driver_name: `${TEST_PREFIX} Qualifier ${String(index + 1).padStart(2, "0")}`,
    group_number: (index % 6) + 1,
    image_url: null,
    is_active: true
  }));

  const { data, error } = await supabase.from("drivers").insert(payload).select("id,driver_name");
  if (error || !data || data.length !== 33) {
    throw new Error(`Failed seeding Indy drivers: ${error?.message ?? "unexpected row count"}`);
  }

  return data as DriverSeed[];
};

const getRaceByName = async (raceName: string): Promise<RaceSeed> => {
  const { data, error } = await supabase
    .from("races")
    .select("id,race_name,pick_format")
    .eq("race_name", raceName)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle<RaceSeed>();

  if (error || !data) {
    throw new Error(`Failed loading Indy race "${raceName}": ${error?.message ?? "not found"}`);
  }

  return data;
};

const qualifyingPasteForDrivers = (drivers: DriverSeed[]): string =>
  [
    "Pos\tCar\tDriver",
    ...drivers.map((driver, index) => `${index + 1}\t${index + 10}\t${driver.driver_name}`)
  ].join("\n");

const resultsPasteForDrivers = (drivers: DriverSeed[]): string =>
  [
    "Pos\tStart\tCar\tDriver\tTeam\tLaps\tLed\tStatusLaps\tTime\tAvg Speed\tStatus\tPoints",
    ...drivers.map((driver, index) => {
      const position = index + 1;
      const points = 100 - index;
      const averageSpeed = (182.5 - index / 10).toFixed(3);
      return `${position}\t${position}\t${index + 10}\t${driver.driver_name}\t${TEST_PREFIX} Team\t200\t0\t0\t01:00:00\t${averageSpeed}\tRunning\t${points}`;
    })
  ].join("\n");

const loadRaceGroups = async (raceId: number): Promise<RaceGroupSeed[]> => {
  const { data, error } = await supabase
    .from("race_driver_groups")
    .select("driver_id,group_number,qualifying_position")
    .eq("race_id", raceId)
    .order("group_number", { ascending: true })
    .order("qualifying_position", { ascending: true });

  if (error) {
    throw new Error(`Failed loading Indy race groups: ${error.message}`);
  }

  return (data ?? []) as RaceGroupSeed[];
};

test.describe.serial("Indianapolis 500 Pick'em Flow", () => {
  test.beforeAll(async () => {
    await cleanupPlaywrightArtifacts({ recomputeDriverPoints: true });
  });

  test.afterAll(async () => {
    await cleanupPlaywrightArtifacts({ recomputeDriverPoints: true });
  });

  test("qualifying-order groups, 8-driver picks, race-start lock, preview, and leaderboard display", async ({
    browser,
    browserName,
    isMobile
  }) => {
    test.skip(
      browserName !== "chromium" || isMobile,
      "Heavy Indy mutation flow is limited to desktop Chromium."
    );

    const clientIssues: string[] = [];
    const raceName = `${TEST_PREFIX} Indianapolis 500`;
    const adminUser = await createSeedUser("Admin", "admin");
    const participant = await createSeedUser("Participant", "participant");
    const drivers = await seedIndyDrivers();

    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    trackClientIssues(adminPage, "indy-admin", clientIssues);
    await signIn(adminPage, adminUser.email);

    await adminPage.goto("/admin?tab=races");
    const createRaceForm = adminPage.getByTestId("admin-race-create-form");
    const now = new Date();
    const qualifyingStart = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const raceStart = new Date(now.getTime() + 90 * 60 * 1000);

    await createRaceForm.getByTestId("admin-race-create-name").fill(raceName);
    await createRaceForm.locator('input[name="round_number"]').fill("92");
    await createRaceForm.getByTestId("admin-race-create-qualifying").fill(toLocalInput(qualifyingStart));
    await createRaceForm.getByTestId("admin-race-create-start").fill(toLocalInput(raceStart));
    await createRaceForm.getByTestId("admin-race-create-payout").fill("500");
    await createRaceForm.getByTestId("admin-race-create-pick-format").selectOption("indy_500");
    await createRaceForm.getByTestId("admin-race-create-submit").click();
    await expect(adminPage.locator("main")).toContainText("Race added.");
    await expect(adminPage.locator("main")).toContainText(raceName);
    await expect(adminPage.locator("details").filter({ hasText: raceName })).toContainText("Indy 500");

    const race = await getRaceByName(raceName);
    expect(race.pick_format).toBe("indy_500");

    const participantContext = await browser.newContext();
    const participantPage = await participantContext.newPage();
    trackClientIssues(participantPage, "indy-participant", clientIssues);
    await signIn(participantPage, participant.email);

    await participantPage.goto("/picks");
    await expect(participantPage.locator("main")).toContainText(raceName);
    await expect(participantPage.locator("main")).toContainText("Status: Open");
    await expect(participantPage.locator("main")).toContainText("Pick Lock (Race Start)");
    await expect(participantPage.locator("main")).toContainText("Indy 500: 8 picks");
    await expect(participantPage.locator("main")).toContainText(
      "Picks are unavailable until admin imports the Indianapolis 500 qualifying order"
    );
    await expect(participantPage.getByRole("button", { name: "Save Pick'em Form" })).toBeDisabled();

    await adminPage.goto("/admin?tab=results");
    await adminPage.getByText("Indianapolis 500 qualifying order").click();
    const qualifyingForm = adminPage.getByTestId("admin-indy-qualifying-import-form");
    await expect(qualifyingForm.getByTestId("admin-indy-qualifying-race-select")).toContainText(raceName);
    await qualifyingForm.getByTestId("admin-indy-qualifying-race-select").selectOption(String(race.id));
    await qualifyingForm.getByTestId("admin-indy-qualifying-paste").fill(qualifyingPasteForDrivers(drivers));
    await qualifyingForm.getByTestId("admin-indy-qualifying-submit").click();
    await expect(adminPage.locator("main")).toContainText(
      "Imported Indianapolis 500 qualifying order"
    );
    await expect(adminPage.locator("main")).toContainText("33 drivers across 8 groups");

    const raceGroups = await loadRaceGroups(race.id);
    expect(raceGroups).toHaveLength(33);
    for (let groupNumber = 1; groupNumber <= 8; groupNumber += 1) {
      const expectedCount = groupNumber < 8 ? 4 : 5;
      expect(raceGroups.filter((group) => group.group_number === groupNumber)).toHaveLength(expectedCount);
    }
    expect(raceGroups.map((group) => group.qualifying_position)).toEqual(
      Array.from({ length: 33 }, (_, index) => index + 1)
    );

    const firstPickByGroup = new Map<number, RaceGroupSeed>();
    raceGroups.forEach((group) => {
      if (!firstPickByGroup.has(group.group_number)) {
        firstPickByGroup.set(group.group_number, group);
      }
    });

    await participantPage.goto("/picks");
    await expect(participantPage.locator("main")).toContainText(raceName);
    await expect(participantPage.locator("main")).toContainText("Indianapolis 500 picks use qualifying-order groups");
    await expect(participantPage.locator("main")).toContainText("Group 8");
    await expect(participantPage.locator("main")).toContainText("Pick 1 of 5");
    await expect(participantPage.locator("main")).toContainText("Qualifying Position: 33");
    await expect(participantPage.locator("main")).not.toContainText("Picks are unavailable until admin imports");
    await participantPage.locator('input[name="average_speed"]').fill("181.777");

    for (let groupNumber = 1; groupNumber <= 8; groupNumber += 1) {
      const selected = firstPickByGroup.get(groupNumber);
      expect(selected, `Expected seeded qualifying group ${groupNumber}`).toBeTruthy();
      await participantPage
        .locator(`input[name="driver_group${groupNumber}_id"][value="${selected!.driver_id}"]`)
        .check();
    }

    await participantPage.getByRole("button", { name: "Save Pick'em Form" }).click();
    await expect(participantPage.locator("main")).toContainText("Last Saved Submission");
    await expect(participantPage.locator("main")).toContainText("Group 8");

    const { data: savedPick, error: savedPickError } = await supabase
      .from("picks")
      .select("driver_group7_id,driver_group8_id,average_speed")
      .eq("race_id", race.id)
      .eq("user_id", participant.id)
      .maybeSingle();
    if (savedPickError || !savedPick) {
      throw new Error(`Failed loading saved Indy pick: ${savedPickError?.message ?? "missing row"}`);
    }
    expect(savedPick.driver_group7_id).toBe(firstPickByGroup.get(7)!.driver_id);
    expect(savedPick.driver_group8_id).toBe(firstPickByGroup.get(8)!.driver_id);

    await adminPage.goto("/admin?tab=results");
    const resultsImportForm = adminPage.getByTestId("admin-results-import-form");
    await resultsImportForm.getByTestId("admin-results-import-race-select").selectOption(String(race.id));
    await resultsImportForm.getByTestId("admin-results-import-paste").fill(resultsPasteForDrivers(drivers));
    await resultsImportForm.getByTestId("admin-results-import-preview").click();
    await expect(resultsImportForm).toContainText(`Publish Preview: ${raceName}`);
    await expect(resultsImportForm).toContainText("Indianapolis 500 format: 8 qualifying-order groups.");
    await expect(resultsImportForm).toContainText("8 groups");
    await expect(resultsImportForm).toContainText("Matched Drivers");
    await expect(resultsImportForm).toContainText("Unmatched Rows");
    await expect(resultsImportForm).toContainText("Winner Avg Speed");
    await expect(resultsImportForm).toContainText("Highest Possible");
    await expect(resultsImportForm).toContainText("Lowest Possible");
    await expect(resultsImportForm).toContainText("No-Pick Users");
    await expect(resultsImportForm).toContainText("Preview is clean. Ready to publish.");
    await expect(resultsImportForm.getByTestId("admin-results-import-submit")).toBeEnabled();

    const lockedRaceStart = new Date(Date.now() - 5 * 60 * 1000);
    const lockedQualifyingStart = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const { error: lockRaceError } = await supabase
      .from("races")
      .update({
        qualifying_start_at: lockedQualifyingStart.toISOString(),
        race_date: lockedRaceStart.toISOString()
      })
      .eq("id", race.id);
    if (lockRaceError) {
      throw new Error(`Failed locking Indy race: ${lockRaceError.message}`);
    }

    await participantPage.goto("/picks");
    await expect(participantPage.locator("main")).not.toContainText(raceName);

    await resultsImportForm.getByTestId("admin-results-import-submit").click();
    await expect(adminPage.getByTestId("admin-results-save-alert")).toContainText(
      "Published 33 complete result row(s)"
    );

    const expectedTotal = Array.from({ length: 8 }, (_, index) => {
      const groupNumber = index + 1;
      const selected = firstPickByGroup.get(groupNumber)!;
      const qualifyingIndex = (selected.qualifying_position ?? 1) - 1;
      return 100 - qualifyingIndex;
    }).reduce((sum, points) => sum + points, 0);

    await participantPage.goto(`/leaderboard?tab=picks&race_id=${race.id}`);
    await expect(participantPage.locator("main")).toContainText(raceName);
    await expect(participantPage.locator("main")).toContainText("G7 Pick");
    await expect(participantPage.locator("main")).toContainText("G8 Pick");

    const participantRow = participantPage.locator("tbody tr").filter({ hasText: participant.teamName }).first();
    await expect(participantRow).toContainText(String(expectedTotal));
    await expect(participantRow).toContainText(
      drivers.find((driver) => driver.id === firstPickByGroup.get(8)!.driver_id)!.driver_name
    );

    await adminContext.close();
    await participantContext.close();

    console.log("INDY_CLIENT_SIDE_ISSUES_START");
    if (clientIssues.length === 0) {
      console.log("none");
    } else {
      for (const issue of clientIssues) {
        console.log(issue);
      }
    }
    console.log("INDY_CLIENT_SIDE_ISSUES_END");

    expect(clientIssues).toEqual([]);
  });
});

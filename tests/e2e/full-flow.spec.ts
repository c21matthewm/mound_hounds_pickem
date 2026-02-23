import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { trackClientIssues } from "./helpers/monitoring";

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

const readEnvFromFile = (key: string): string | null => {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) {
    return null;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const splitIndex = trimmed.indexOf("=");
    if (splitIndex <= 0) {
      continue;
    }

    const currentKey = trimmed.slice(0, splitIndex).trim();
    if (currentKey !== key) {
      continue;
    }

    const rawValue = trimmed.slice(splitIndex + 1).trim();
    return rawValue.replace(/^['"]|['"]$/g, "");
  }

  return null;
};

const requiredEnv = (key: string): string => {
  const fromProcess = process.env[key];
  if (fromProcess && fromProcess.trim().length > 0) {
    return fromProcess.trim();
  }

  const fromFile = readEnvFromFile(key);
  if (fromFile && fromFile.trim().length > 0) {
    return fromFile.trim();
  }

  throw new Error(`Missing required env var: ${key}`);
};

const supabase = createClient(
  requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

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
  await expect(page).toHaveURL(/\/dashboard|\/admin|\/onboarding/);
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
  const createdDriverIds: number[] = [];

  const loadDrivers = async (): Promise<DriverSeed[]> => {
    const { data, error } = await supabase
      .from("drivers")
      .select("id,driver_name,group_number")
      .eq("is_active", true)
      .order("group_number", { ascending: true })
      .order("current_standing", { ascending: true });

    if (error) {
      throw new Error(`Failed loading drivers: ${error.message}`);
    }

    return (data ?? []) as DriverSeed[];
  };

  const mapByGroup = (drivers: DriverSeed[]): Map<number, DriverSeed[]> => {
    const byGroup = new Map<number, DriverSeed[]>();
    for (let group = 1; group <= 6; group += 1) {
      byGroup.set(group, []);
    }
    drivers.forEach((driver) => {
      byGroup.get(driver.group_number)?.push(driver);
    });
    return byGroup;
  };

  let allDrivers = await loadDrivers();
  let byGroup = mapByGroup(allDrivers);

  for (let group = 1; group <= 6; group += 1) {
    const minimumCount = group === 1 ? 2 : 1;
    while ((byGroup.get(group)?.length ?? 0) < minimumCount) {
      const seedName = `${TEST_PREFIX} Driver G${group} #${createdDriverIds.length + 1}`;
      const { data: inserted, error: insertError } = await supabase
        .from("drivers")
        .insert({
          championship_points: 0,
          current_standing: 9000 + createdDriverIds.length,
          driver_name: seedName,
          group_number: group,
          image_url: null,
          is_active: true
        })
        .select("id")
        .single();

      if (insertError || !inserted) {
        throw new Error(`Failed seeding group ${group} driver: ${insertError?.message ?? "unknown"}`);
      }

      createdDriverIds.push(inserted.id as number);
      allDrivers = await loadDrivers();
      byGroup = mapByGroup(allDrivers);
    }
  }

  return { byGroup, createdDriverIds };
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
  await expect(page.locator("main")).toContainText("Pick'em form saved.");
};

test.describe.serial("Full App Flow", () => {
  const createdUserIds: string[] = [];
  const createdDriverIds: number[] = [];
  const createdRaceIds: number[] = [];
  const clientIssues: string[] = [];
  const findings: string[] = [];

  let adminUser: SeedUser;
  let participant1: SeedUser;
  let participant2: SeedUser;
  let participant3: SeedUser;

  test.afterAll(async () => {
    if (createdRaceIds.length > 0) {
      await supabase.from("races").delete().in("id", createdRaceIds);
    }

    if (createdUserIds.length > 0) {
      await supabase.from("feedback_items").delete().in("user_id", createdUserIds);
      await supabase.from("picks").delete().in("user_id", createdUserIds);
      await supabase.from("profiles").delete().in("id", createdUserIds);
    }

    if (createdDriverIds.length > 0) {
      await supabase.from("drivers").delete().in("id", createdDriverIds);
    }

    for (const userId of createdUserIds) {
      await supabase.auth.admin.deleteUser(userId);
    }
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
    createdUserIds.push(adminUser.id, participant1.id, participant2.id, participant3.id);

    const driverCoverage = await ensureDriverCoverage();
    createdDriverIds.push(...driverCoverage.createdDriverIds);

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
    await adminPage.goto("/admin?tab=races");
    await expect(adminPage.locator("main")).toContainText("Admin Dashboard");

    const addRaceForm = adminPage
      .locator("form")
      .filter({ has: adminPage.getByRole("button", { name: "Add race" }) })
      .first();

    const now = new Date();
    const raceAQualifying = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
    raceAQualifying.setHours(raceAQualifying.getHours() + 2);
    const raceAStart = new Date(raceAQualifying.getTime() + 3 * 60 * 60 * 1000);

    await addRaceForm.locator('input[name="race_name"]').fill(raceAName);
    await addRaceForm.locator('input[name="qualifying_start_at"]').fill(toLocalInput(raceAQualifying));
    await addRaceForm.locator('input[name="race_date"]').fill(toLocalInput(raceAStart));
    await addRaceForm.locator('input[name="payout"]').fill("150");
    await addRaceForm.locator('input[name="title_image_file"]').setInputFiles(fixtureImage);
    await addRaceForm.getByRole("button", { name: "Add race" }).click();
    await expect(adminPage.locator("main")).toContainText("Race added.");
    await expect(adminPage.locator("table")).toContainText(raceAName);

    const raceA = await getRaceByName(raceAName);
    createdRaceIds.push(raceA.id);
    expect(raceA.title_image_url, "Race title image URL should be saved after upload.").toBeTruthy();

    await adminPage.goto("/admin?tab=races");
    const addRaceFormSecond = adminPage
      .locator("form")
      .filter({ has: adminPage.getByRole("button", { name: "Add race" }) })
      .first();

    const raceBQualifying = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
    const raceBStart = new Date(raceBQualifying.getTime() + 2 * 60 * 60 * 1000);
    await addRaceFormSecond.locator('input[name="race_name"]').fill(raceBName);
    await addRaceFormSecond.locator('input[name="qualifying_start_at"]').fill(toLocalInput(raceBQualifying));
    await addRaceFormSecond.locator('input[name="race_date"]').fill(toLocalInput(raceBStart));
    await addRaceFormSecond.locator('input[name="payout"]').fill("95");
    await addRaceFormSecond.locator('input[name="title_image_file"]').setInputFiles([]);
    await addRaceFormSecond.getByRole("button", { name: "Add race" }).click();
    await expect(adminPage.locator("main")).toContainText("Race added.");
    await expect(adminPage.locator("table")).toContainText(raceBName);

    const raceB = await getRaceByName(raceBName);
    createdRaceIds.push(raceB.id);

    const p1Context = await browser.newContext();
    const p1Page = await p1Context.newPage();
    trackClientIssues(p1Page, "participant1", clientIssues);
    await signIn(p1Page, participant1.email);
    await submitPicks(p1Page, raceAName, pickA, 178.101);
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

    const raceAEditForm = adminPage
      .locator("form")
      .filter({ has: adminPage.locator(`input[name="race_name"][value="${raceAName}"]`) })
      .first();
    const lockQualifying = new Date(Date.now() - 90 * 60 * 1000);
    const lockRaceStart = new Date(Date.now() + 2 * 60 * 60 * 1000);
    await raceAEditForm.locator('input[name="qualifying_start_at"]').fill(toLocalInput(lockQualifying));
    await raceAEditForm.locator('input[name="race_date"]').fill(toLocalInput(lockRaceStart));
    await raceAEditForm.getByRole("button", { name: "Save" }).click();
    await expect(adminPage.locator("main")).toContainText("Race updated.");

    await p1Page.goto("/picks");
    await expect(p1Page.locator("main")).toContainText("Qualifying has started.");
    await expect(p1Page.getByRole("button", { name: "Picks are locked" })).toBeDisabled();

    await p1Page.goto(`/leaderboard?tab=picks&race_id=${raceA.id}`);
    await expect(p1Page.locator("main")).toContainText(raceAName);
    await expect(p1Page.locator("tbody tr").filter({ hasText: participant1.teamName }).first()).toContainText("-");

    const pointsByPickB = new Map<number, number>([
      [pickB[1], 50],
      [pickB[2], 44],
      [pickB[3], 42],
      [pickB[4], 40],
      [pickB[5], 38],
      [pickB[6], 36]
    ]);

    await adminPage.goto("/admin?tab=results");
    const manualResultsForm = adminPage.getByTestId("admin-results-manual-form");
    for (const [driverId, points] of pointsByPickB.entries()) {
      await manualResultsForm.locator('select[name="race_id"]').selectOption(String(raceA.id));
      await manualResultsForm.locator('select[name="driver_id"]').selectOption(String(driverId));
      await manualResultsForm.locator('input[name="points"]').fill(String(points));
      await manualResultsForm.getByRole("button", { name: "Save result" }).click();
      await expect(adminPage.getByTestId("admin-results-save-alert")).toContainText(
        `Saved ${points} point(s)`
      );
      await expect(adminPage.getByTestId("admin-results-save-alert")).toContainText(raceAName);
    }

    await p1Page.goto("/leaderboard");
    await expect(p1Page.locator("main")).toContainText(`Latest Race: ${raceAName}`);

    const { count: raceResultCount, error: raceResultCountError } = await supabase
      .from("results")
      .select("id", { count: "exact", head: true })
      .eq("race_id", raceA.id);
    if (raceResultCountError) {
      throw new Error(`Failed counting race results: ${raceResultCountError.message}`);
    }
    if ((raceResultCount ?? 0) < 6) {
      findings.push(
        `Results entry count was ${raceResultCount ?? 0} for race "${raceAName}" after six manual submissions (expected at least 6).`
      );
    }

    await p1Page.goto(`/leaderboard?tab=picks&race_id=${raceA.id}`);
    const p1Row = p1Page.locator("tbody tr").filter({ hasText: participant1.teamName }).first();
    await expect(p1Row).not.toContainText("-");

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
    const raceAEditFormForArchive = adminPage
      .locator("form")
      .filter({ has: adminPage.locator(`input[name="race_name"][value="${raceAName}"]`) })
      .first();
    const raceACard = raceAEditFormForArchive.locator(
      "xpath=ancestor::div[contains(@class,'rounded-md')][1]"
    );
    adminPage.once("dialog", (dialog) => dialog.accept());
    await raceACard.getByRole("button", { name: "Archive race" }).click();
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

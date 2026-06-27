import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const PLAYWRIGHT_NAME_PREFIXES = ["[PW E2E ", "[PW INDY ", "[PW AUTH "];
const PLAYWRIGHT_RACE_PREFIXES = ["[PW E2E ", "[PW INDY "];
const PLAYWRIGHT_DRIVER_PREFIXES = ["[PW E2E ", "[PW INDY "];

const PLAYWRIGHT_RUN_ID = "[0-9a-f]{8}";
const PLAYWRIGHT_PROFILE_PATTERNS = [
  new RegExp(`^\\[PW E2E ${PLAYWRIGHT_RUN_ID}\\] (Admin|Participant[1-3]) Team$`),
  new RegExp(`^\\[PW E2E ${PLAYWRIGHT_RUN_ID}\\] (Admin|Participant[1-3]) Owner$`),
  new RegExp(`^\\[PW INDY ${PLAYWRIGHT_RUN_ID}\\] (Admin|Participant) Team$`),
  new RegExp(`^\\[PW INDY ${PLAYWRIGHT_RUN_ID}\\] (Admin|Participant) Owner$`),
  new RegExp(`^\\[PW AUTH ${PLAYWRIGHT_RUN_ID}\\] Team ${PLAYWRIGHT_RUN_ID}$`),
  new RegExp(`^\\[PW AUTH ${PLAYWRIGHT_RUN_ID}\\] Tester$`)
];
const PLAYWRIGHT_RACE_PATTERNS = [
  new RegExp(`^\\[PW E2E ${PLAYWRIGHT_RUN_ID}\\] Race [AB]$`),
  new RegExp(`^\\[PW INDY ${PLAYWRIGHT_RUN_ID}\\] Indianapolis 500$`)
];
const PLAYWRIGHT_DRIVER_PATTERNS = [
  new RegExp(`^\\[PW E2E ${PLAYWRIGHT_RUN_ID}\\] Driver G[1-6] #[1-9][0-9]*$`),
  new RegExp(`^\\[PW INDY ${PLAYWRIGHT_RUN_ID}\\] Qualifier [0-9]{2}$`)
];
const PLAYWRIGHT_FEEDBACK_PATTERNS = [
  new RegExp(
    `^\\[PW E2E ${PLAYWRIGHT_RUN_ID}\\] Feedback smoke check: form submission from automated e2e test\\.$`
  )
];
const PLAYWRIGHT_AUTH_EMAIL_PATTERNS = [
  new RegExp(`^pw-e2e-${PLAYWRIGHT_RUN_ID}-(admin|participant[1-3])@example\\.com$`),
  new RegExp(`^pw-indy-${PLAYWRIGHT_RUN_ID}-(admin|participant)@example\\.com$`),
  new RegExp(`^pw-auth-${PLAYWRIGHT_RUN_ID}@example\\.com$`)
];

const apply = process.argv.includes("--apply");

const readEnvFromFile = (key) => {
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

const requiredEnv = (key) => {
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

const uniqueBy = (rows, key) => {
  const seen = new Set();
  return rows.filter((row) => {
    const value = row[key];
    if (seen.has(value)) {
      return false;
    }
    seen.add(value);
    return true;
  });
};

const matchesAnyPattern = (value, patterns) =>
  typeof value === "string" && patterns.some((pattern) => pattern.test(value));

const isPlaywrightProfile = (profile) =>
  matchesAnyPattern(profile.team_name, PLAYWRIGHT_PROFILE_PATTERNS) ||
  matchesAnyPattern(profile.full_name, PLAYWRIGHT_PROFILE_PATTERNS);

const isPlaywrightRace = (race) => matchesAnyPattern(race.race_name, PLAYWRIGHT_RACE_PATTERNS);

const isPlaywrightDriver = (driver) =>
  matchesAnyPattern(driver.driver_name, PLAYWRIGHT_DRIVER_PATTERNS);

const isPlaywrightFeedback = (feedback) =>
  matchesAnyPattern(feedback.details, PLAYWRIGHT_FEEDBACK_PATTERNS);

const isPlaywrightAuthUser = (user) =>
  matchesAnyPattern(user.email, PLAYWRIGHT_AUTH_EMAIL_PATTERNS);

const selectByPrefixes = async ({ table, column, select, prefixes }) => {
  const rows = [];
  for (const prefix of prefixes) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .ilike(column, `${prefix}%`);
    if (error) {
      throw new Error(`Failed selecting ${table}.${column} ${prefix}: ${error.message}`);
    }
    rows.push(...(data ?? []));
  }
  return rows;
};

const listAllTestAuthUsers = async () => {
  const users = [];
  let page = 1;
  const perPage = 200;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) {
      throw new Error(`Failed listing auth users: ${error.message}`);
    }

    const currentUsers = data?.users ?? [];
    users.push(
      ...currentUsers.filter(isPlaywrightAuthUser)
    );

    if (currentUsers.length < perPage) {
      break;
    }
    page += 1;
  }

  return users;
};

const deleteByIds = async ({ table, ids, label }) => {
  if (ids.length === 0) {
    return 0;
  }

  const { data, error } = await supabase.from(table).delete().in("id", ids).select("id");
  if (error) {
    throw new Error(`Failed deleting ${label}: ${error.message}`);
  }

  return (data ?? []).length;
};

const deleteByUserIds = async ({ table, userIds, label }) => {
  if (userIds.length === 0) {
    return 0;
  }

  const { data, error } = await supabase
    .from(table)
    .delete()
    .in("user_id", userIds)
    .select("id");
  if (error) {
    throw new Error(`Failed deleting ${label}: ${error.message}`);
  }

  return (data ?? []).length;
};

const main = async () => {
  const [
    raceCandidates,
    driverCandidates,
    profileTeamCandidates,
    profileFullNameCandidates,
    feedbackCandidates,
    authUsers
  ] =
    await Promise.all([
      selectByPrefixes({
        table: "races",
        column: "race_name",
        select: "id,race_name",
        prefixes: PLAYWRIGHT_RACE_PREFIXES
      }),
      selectByPrefixes({
        table: "drivers",
        column: "driver_name",
        select: "id,driver_name",
        prefixes: PLAYWRIGHT_DRIVER_PREFIXES
      }),
      selectByPrefixes({
        table: "profiles",
        column: "team_name",
        select: "id,team_name,full_name",
        prefixes: PLAYWRIGHT_NAME_PREFIXES
      }),
      selectByPrefixes({
        table: "profiles",
        column: "full_name",
        select: "id,team_name,full_name",
        prefixes: PLAYWRIGHT_NAME_PREFIXES
      }),
      selectByPrefixes({
        table: "feedback_items",
        column: "details",
        select: "id,user_id,details",
        prefixes: PLAYWRIGHT_NAME_PREFIXES
      }),
      listAllTestAuthUsers()
    ]);

  const races = uniqueBy(raceCandidates, "id").filter(isPlaywrightRace);
  const driversByName = uniqueBy(driverCandidates, "id").filter(isPlaywrightDriver);
  const profiles = uniqueBy([...profileTeamCandidates, ...profileFullNameCandidates], "id").filter(
    isPlaywrightProfile
  );
  const feedbackByDetails = uniqueBy(feedbackCandidates, "id").filter(isPlaywrightFeedback);
  const authUserIds = new Set(authUsers.map((user) => user.id));
  profiles.forEach((profile) => authUserIds.add(profile.id));

  const raceIds = uniqueBy(races, "id").map((race) => race.id);
  const driverIds = uniqueBy(driversByName, "id").map((driver) => driver.id);
  const profileIds = profiles.map((profile) => profile.id);
  const userIds = Array.from(authUserIds);
  const feedbackIds = uniqueBy(feedbackByDetails, "id").map((feedback) => feedback.id);

  console.log(`Mode: ${apply ? "apply" : "dry-run"}`);
  console.log("Safety: exact Playwright-generated names/emails only; no generic PW/Indy substring matching.");
  console.log(`Test races: ${raceIds.length}`);
  races.forEach((race) => console.log(`  race ${race.id}: ${race.race_name}`));
  console.log(`Test drivers: ${driverIds.length}`);
  driversByName.forEach((driver) => console.log(`  driver ${driver.id}: ${driver.driver_name}`));
  console.log(`Test profiles: ${profileIds.length}`);
  profiles.forEach((profile) => console.log(`  profile ${profile.id}: ${profile.team_name}`));
  console.log(`Test auth users: ${userIds.length}`);
  authUsers.forEach((user) => console.log(`  auth ${user.id}: ${user.email}`));
  console.log(`Test feedback rows by details: ${feedbackIds.length}`);

  if (!apply) {
    console.log("Dry run only. Re-run with --apply to delete these artifacts.");
    return;
  }

  const deletedRaceCount = await deleteByIds({
    table: "races",
    ids: raceIds,
    label: "test races"
  });
  const deletedFeedbackByDetailsCount = await deleteByIds({
    table: "feedback_items",
    ids: feedbackIds,
    label: "test feedback rows by details"
  });
  const deletedFeedbackByUserCount = await deleteByUserIds({
    table: "feedback_items",
    userIds,
    label: "test feedback rows by user"
  });
  const deletedPicksByUserCount = await deleteByUserIds({
    table: "picks",
    userIds,
    label: "test picks by user"
  });
  const deletedRemindersByUserCount = await deleteByUserIds({
    table: "pick_reminders",
    userIds,
    label: "test reminders by user"
  });

  let deletedAuthUserCount = 0;
  const failedAuthDeletes = [];
  for (const userId of userIds) {
    const { error } = await supabase.auth.admin.deleteUser(userId);
    if (error) {
      failedAuthDeletes.push(`${userId}: ${error.message}`);
      continue;
    }
    deletedAuthUserCount += 1;
  }

  const deletedProfileCount = await deleteByIds({
    table: "profiles",
    ids: profileIds,
    label: "remaining test profiles"
  });
  const deletedDriverCount = await deleteByIds({
    table: "drivers",
    ids: driverIds,
    label: "test drivers"
  });

  console.log("Deleted:");
  console.log(`  races: ${deletedRaceCount}`);
  console.log(`  feedback by details: ${deletedFeedbackByDetailsCount}`);
  console.log(`  feedback by user: ${deletedFeedbackByUserCount}`);
  console.log(`  picks by user: ${deletedPicksByUserCount}`);
  console.log(`  reminders by user: ${deletedRemindersByUserCount}`);
  console.log(`  auth users: ${deletedAuthUserCount}`);
  console.log(`  remaining profiles: ${deletedProfileCount}`);
  console.log(`  drivers: ${deletedDriverCount}`);

  if (failedAuthDeletes.length > 0) {
    throw new Error(`Some auth users could not be deleted: ${failedAuthDeletes.join(" | ")}`);
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

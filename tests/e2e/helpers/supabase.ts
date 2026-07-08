import fs from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

const RACE_IMAGE_BUCKET = "race-title-images";

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

type RaceCandidate = {
  id: number;
  race_name: string;
  title_image_url: string | null;
};

type DriverCandidate = {
  driver_name: string;
  id: number;
};

type ProfileCandidate = {
  full_name: string | null;
  id: string;
  team_name: string | null;
};

type FeedbackCandidate = {
  details: string | null;
  id: number;
  user_id: string | null;
};

type CleanupSummary = {
  deletedAuthUsers: number;
  deletedDrivers: number;
  deletedFeedbackByDetails: number;
  deletedFeedbackByUser: number;
  deletedPickRemindersByUser: number;
  deletedPicksByRace: number;
  deletedPicksByUser: number;
  deletedProfiles: number;
  deletedRaceDriverGroupsByDriver: number;
  deletedRaceDriverGroupsByRace: number;
  deletedRaceImages: number;
  deletedRaces: number;
  deletedResultsByDriver: number;
  deletedResultsByRace: number;
  recomputedDriverPoints: boolean;
};

export const readEnvFromFile = (key: string): string | null => {
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

export const requiredEnv = (key: string): string => {
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

export const requireSupabaseE2EOptIn = () => {
  if (process.env.PW_ALLOW_SUPABASE_E2E === "1") {
    return;
  }

  throw new Error(
    [
      "Refusing to run Supabase-mutating Playwright tests without PW_ALLOW_SUPABASE_E2E=1.",
      "Use a dedicated/local Supabase test database whenever possible.",
      "Do not point these tests at the live app database unless you intentionally accept that risk."
    ].join(" ")
  );
};

export const createE2ESupabaseClient = (): SupabaseClient => {
  requireSupabaseE2EOptIn();

  return createClient(requiredEnv("NEXT_PUBLIC_SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
};

export const supabase = createE2ESupabaseClient();

const uniqueBy = <T, K extends keyof T>(rows: T[], key: K): T[] => {
  const seen = new Set<T[K]>();
  return rows.filter((row) => {
    const value = row[key];
    if (seen.has(value)) {
      return false;
    }
    seen.add(value);
    return true;
  });
};

const matchesAnyPattern = (value: string | null | undefined, patterns: RegExp[]) =>
  typeof value === "string" && patterns.some((pattern) => pattern.test(value));

const isPlaywrightProfile = (profile: ProfileCandidate) =>
  matchesAnyPattern(profile.team_name, PLAYWRIGHT_PROFILE_PATTERNS) ||
  matchesAnyPattern(profile.full_name, PLAYWRIGHT_PROFILE_PATTERNS);

const isPlaywrightRace = (race: RaceCandidate) =>
  matchesAnyPattern(race.race_name, PLAYWRIGHT_RACE_PATTERNS);

const isPlaywrightDriver = (driver: DriverCandidate) =>
  matchesAnyPattern(driver.driver_name, PLAYWRIGHT_DRIVER_PATTERNS);

const isPlaywrightFeedback = (feedback: FeedbackCandidate) =>
  matchesAnyPattern(feedback.details, PLAYWRIGHT_FEEDBACK_PATTERNS);

const isPlaywrightAuthUser = (user: User) =>
  matchesAnyPattern(user.email, PLAYWRIGHT_AUTH_EMAIL_PATTERNS);

const selectByPrefixes = async <T>({
  column,
  prefixes,
  select,
  table
}: {
  column: string;
  prefixes: string[];
  select: string;
  table: string;
}): Promise<T[]> => {
  const rows: T[] = [];
  for (const prefix of prefixes) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .ilike(column, `${prefix}%`);
    if (error) {
      throw new Error(`Failed selecting ${table}.${column} ${prefix}: ${error.message}`);
    }
    rows.push(...((data ?? []) as T[]));
  }
  return rows;
};

const listAllTestAuthUsers = async (): Promise<User[]> => {
  const users: User[] = [];
  let page = 1;
  const perPage = 200;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) {
      throw new Error(`Failed listing auth users: ${error.message}`);
    }

    const currentUsers = data?.users ?? [];
    users.push(...currentUsers.filter(isPlaywrightAuthUser));

    if (currentUsers.length < perPage) {
      break;
    }
    page += 1;
  }

  return users;
};

const deleteByIds = async ({
  ids,
  label,
  table
}: {
  ids: Array<number | string>;
  label: string;
  table: string;
}) => {
  if (ids.length === 0) {
    return 0;
  }

  const { data, error } = await supabase.from(table).delete().in("id", ids).select("id");
  if (error) {
    throw new Error(`Failed deleting ${label}: ${error.message}`);
  }

  return (data ?? []).length;
};

const deleteByColumnIds = async ({
  column,
  ids,
  label,
  table
}: {
  column: string;
  ids: Array<number | string>;
  label: string;
  table: string;
}) => {
  if (ids.length === 0) {
    return 0;
  }

  const { data, error } = await supabase.from(table).delete().in(column, ids).select(column);
  if (error) {
    throw new Error(`Failed deleting ${label}: ${error.message}`);
  }

  return (data ?? []).length;
};

const maybeStorageErrorCode = (error: unknown): string => {
  if (!error || typeof error !== "object") {
    return "";
  }

  const statusCode = "statusCode" in error ? String(error.statusCode) : "";
  const status = "status" in error ? String(error.status) : "";
  const message = "message" in error ? String(error.message) : "";
  return `${statusCode} ${status} ${message}`;
};

const isMissingStorageError = (error: unknown) => /(^|\s)404(\s|$)|not found/i.test(maybeStorageErrorCode(error));

const raceImagePathFromPublicUrl = (value: string | null): string | null => {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    const marker = `/storage/v1/object/public/${RACE_IMAGE_BUCKET}/`;
    const index = url.pathname.indexOf(marker);
    if (index === -1) {
      return null;
    }

    return decodeURIComponent(url.pathname.slice(index + marker.length));
  } catch {
    return null;
  }
};

const listRaceImagePaths = async (races: RaceCandidate[]): Promise<string[]> => {
  const paths = new Set<string>();

  for (const race of races) {
    const pathFromUrl = raceImagePathFromPublicUrl(race.title_image_url);
    if (pathFromUrl?.startsWith(`races/${race.id}/`)) {
      paths.add(pathFromUrl);
    }

    const prefix = `races/${race.id}`;
    const { data, error } = await supabase.storage.from(RACE_IMAGE_BUCKET).list(prefix, {
      limit: 1000
    });
    if (error) {
      if (isMissingStorageError(error)) {
        continue;
      }
      throw new Error(`Failed listing test race images for race ${race.id}: ${error.message}`);
    }

    (data ?? []).forEach((item) => {
      if (item.name) {
        paths.add(`${prefix}/${item.name}`);
      }
    });
  }

  return Array.from(paths);
};

const deleteRaceImages = async (races: RaceCandidate[]) => {
  const imagePaths = await listRaceImagePaths(races);
  if (imagePaths.length === 0) {
    return 0;
  }

  const { data, error } = await supabase.storage.from(RACE_IMAGE_BUCKET).remove(imagePaths);
  if (error && !isMissingStorageError(error)) {
    throw new Error(`Failed deleting test race images: ${error.message}`);
  }

  return data?.length ?? imagePaths.length;
};

const driverGroupForIndex = (index: number): number => {
  if (index < 4) return 1;
  if (index < 8) return 2;
  if (index < 12) return 3;
  if (index < 16) return 4;
  if (index < 20) return 5;
  return 6;
};

const refreshDriverStandingsAndGroups = async () => {
  const { data: activeDrivers, error: activeDriversError } = await supabase
    .from("drivers")
    .select("id,championship_points,current_standing,driver_name")
    .eq("is_active", true)
    .order("championship_points", { ascending: false })
    .order("current_standing", { ascending: true })
    .order("driver_name", { ascending: true });

  if (activeDriversError) {
    throw new Error(`Failed loading active drivers: ${activeDriversError.message}`);
  }

  const { data: inactiveDrivers, error: inactiveDriversError } = await supabase
    .from("drivers")
    .select("id,current_standing,driver_name")
    .eq("is_active", false)
    .order("current_standing", { ascending: true })
    .order("driver_name", { ascending: true });

  if (inactiveDriversError) {
    throw new Error(`Failed loading inactive drivers: ${inactiveDriversError.message}`);
  }

  const rankedActiveDrivers = activeDrivers ?? [];
  const inactiveDriverRows = inactiveDrivers ?? [];

  const activeUpdateResponses = await Promise.all(
    rankedActiveDrivers.map((driver, index) =>
      supabase
        .from("drivers")
        .update({
          current_standing: index + 1,
          group_number: driverGroupForIndex(index)
        })
        .eq("id", driver.id)
    )
  );

  const inactiveUpdateResponses = await Promise.all(
    inactiveDriverRows.map((driver, index) =>
      supabase
        .from("drivers")
        .update({
          current_standing: rankedActiveDrivers.length + index + 1,
          group_number: 6
        })
        .eq("id", driver.id)
    )
  );

  const failed = [...activeUpdateResponses, ...inactiveUpdateResponses].find((result) => result.error);
  if (failed?.error) {
    throw new Error(`Failed refreshing driver standings/groups: ${failed.error.message}`);
  }
};

export const refreshDriverChampionshipPointsFromResults = async () => {
  const [driversResponse, resultsResponse] = await Promise.all([
    supabase.from("drivers").select("id"),
    supabase.from("results").select("driver_id,points")
  ]);

  if (driversResponse.error) {
    throw new Error(`Failed loading drivers for point recompute: ${driversResponse.error.message}`);
  }
  if (resultsResponse.error) {
    throw new Error(`Failed loading results for point recompute: ${resultsResponse.error.message}`);
  }

  const pointsByDriverId = new Map<number, number>();
  (resultsResponse.data ?? []).forEach((result) => {
    const current = pointsByDriverId.get(result.driver_id) ?? 0;
    pointsByDriverId.set(result.driver_id, current + Number(result.points));
  });

  const updateResponses = await Promise.all(
    (driversResponse.data ?? []).map((driver) =>
      supabase
        .from("drivers")
        .update({
          championship_points: pointsByDriverId.get(driver.id) ?? 0
        })
        .eq("id", driver.id)
    )
  );

  const failedUpdate = updateResponses.find((result) => result.error);
  if (failedUpdate?.error) {
    throw new Error(`Failed recomputing driver points: ${failedUpdate.error.message}`);
  }

  await refreshDriverStandingsAndGroups();
};

export const cleanupPlaywrightArtifacts = async ({
  recomputeDriverPoints = true
}: {
  recomputeDriverPoints?: boolean;
} = {}): Promise<CleanupSummary> => {
  const [
    raceCandidates,
    driverCandidates,
    profileTeamCandidates,
    profileFullNameCandidates,
    feedbackCandidates,
    authUsers
  ] = await Promise.all([
    selectByPrefixes<RaceCandidate>({
      table: "races",
      column: "race_name",
      select: "id,race_name,title_image_url",
      prefixes: PLAYWRIGHT_RACE_PREFIXES
    }),
    selectByPrefixes<DriverCandidate>({
      table: "drivers",
      column: "driver_name",
      select: "id,driver_name",
      prefixes: PLAYWRIGHT_DRIVER_PREFIXES
    }),
    selectByPrefixes<ProfileCandidate>({
      table: "profiles",
      column: "team_name",
      select: "id,team_name,full_name",
      prefixes: PLAYWRIGHT_NAME_PREFIXES
    }),
    selectByPrefixes<ProfileCandidate>({
      table: "profiles",
      column: "full_name",
      select: "id,team_name,full_name",
      prefixes: PLAYWRIGHT_NAME_PREFIXES
    }),
    selectByPrefixes<FeedbackCandidate>({
      table: "feedback_items",
      column: "details",
      select: "id,user_id,details",
      prefixes: PLAYWRIGHT_NAME_PREFIXES
    }),
    listAllTestAuthUsers()
  ]);

  const races = uniqueBy(raceCandidates, "id").filter(isPlaywrightRace);
  const drivers = uniqueBy(driverCandidates, "id").filter(isPlaywrightDriver);
  const profiles = uniqueBy([...profileTeamCandidates, ...profileFullNameCandidates], "id").filter(
    isPlaywrightProfile
  );
  const feedbackByDetails = uniqueBy(feedbackCandidates, "id").filter(isPlaywrightFeedback);
  const authUserIds = new Set(authUsers.map((user) => user.id));
  profiles.forEach((profile) => authUserIds.add(profile.id));

  const raceIds = races.map((race) => race.id);
  const driverIds = drivers.map((driver) => driver.id);
  const profileIds = profiles.map((profile) => profile.id);
  const userIds = Array.from(authUserIds);
  const feedbackIds = feedbackByDetails.map((feedback) => feedback.id);

  const deletedRaceImages = await deleteRaceImages(races);
  const deletedResultsByRace = await deleteByColumnIds({
    table: "results",
    column: "race_id",
    ids: raceIds,
    label: "test race results"
  });
  const deletedRaceDriverGroupsByRace = await deleteByColumnIds({
    table: "race_driver_groups",
    column: "race_id",
    ids: raceIds,
    label: "test race driver groups"
  });
  const deletedPicksByRace = await deleteByColumnIds({
    table: "picks",
    column: "race_id",
    ids: raceIds,
    label: "test race picks"
  });
  const deletedRaces = await deleteByIds({
    table: "races",
    ids: raceIds,
    label: "test races"
  });
  const deletedFeedbackByDetails = await deleteByIds({
    table: "feedback_items",
    ids: feedbackIds,
    label: "test feedback rows by details"
  });
  const deletedFeedbackByUser = await deleteByColumnIds({
    table: "feedback_items",
    column: "user_id",
    ids: userIds,
    label: "test feedback rows by user"
  });
  const deletedPicksByUser = await deleteByColumnIds({
    table: "picks",
    column: "user_id",
    ids: userIds,
    label: "test picks by user"
  });
  const deletedPickRemindersByUser = await deleteByColumnIds({
    table: "pick_reminders",
    column: "user_id",
    ids: userIds,
    label: "test reminders by user"
  });
  const deletedResultsByDriver = await deleteByColumnIds({
    table: "results",
    column: "driver_id",
    ids: driverIds,
    label: "test driver results"
  });
  const deletedRaceDriverGroupsByDriver = await deleteByColumnIds({
    table: "race_driver_groups",
    column: "driver_id",
    ids: driverIds,
    label: "test driver race groups"
  });

  let deletedAuthUsers = 0;
  const failedAuthDeletes: string[] = [];
  for (const userId of userIds) {
    const { error } = await supabase.auth.admin.deleteUser(userId);
    if (error) {
      failedAuthDeletes.push(`${userId}: ${error.message}`);
      continue;
    }
    deletedAuthUsers += 1;
  }

  const deletedProfiles = await deleteByIds({
    table: "profiles",
    ids: profileIds,
    label: "remaining test profiles"
  });
  const deletedDrivers = await deleteByIds({
    table: "drivers",
    ids: driverIds,
    label: "test drivers"
  });

  if (failedAuthDeletes.length > 0) {
    throw new Error(`Some auth users could not be deleted: ${failedAuthDeletes.join(" | ")}`);
  }

  if (recomputeDriverPoints) {
    await refreshDriverChampionshipPointsFromResults();
  }

  return {
    deletedAuthUsers,
    deletedDrivers,
    deletedFeedbackByDetails,
    deletedFeedbackByUser,
    deletedPickRemindersByUser,
    deletedPicksByRace,
    deletedPicksByUser,
    deletedProfiles,
    deletedRaceDriverGroupsByDriver,
    deletedRaceDriverGroupsByRace,
    deletedRaceImages,
    deletedRaces,
    deletedResultsByDriver,
    deletedResultsByRace,
    recomputedDriverPoints: recomputeDriverPoints
  };
};

import type { AdminWorkspaceTab } from "@/lib/admin-tabs";
import type { RacePickFormat } from "@/lib/race-format";

export type DriverRow = {
  championship_points: number;
  current_standing: number;
  driver_name: string;
  group_number: number;
  id: number;
  image_url: string | null;
  is_active: boolean;
};

export type RaceRow = {
  archived_at: string | null;
  field_frozen_at: string | null;
  id: number;
  is_archived: boolean;
  official_winning_average_speed: number | string | null;
  pick_format: RacePickFormat;
  pick_window_key: string;
  payout: number | string;
  qualifying_start_at: string;
  race_date: string;
  race_name: string;
  round_number: number;
  season_id: number;
  results_published_at: string | null;
  results_status: "draft" | "published";
  title_image_url: string | null;
  winner_auto_eligible_at: string | null;
  winner_is_manual_override: boolean;
  winner_profile_id: string | null;
  winner_set_at: string | null;
  winner_source: "auto" | "manual";
};

export type WinnerProfileRow = {
  full_name: string | null;
  id: string;
  is_active: boolean;
  role: "admin" | "participant";
  team_name: string;
};

export type SeasonParticipantRow = {
  profile_id: string;
  status: "declined" | "registered";
};

export type LeagueSeasonRow = {
  activated_at: string | null;
  completed_at: string | null;
  display_name: string;
  id: number;
  registration_code_configured_at: string | null;
  roster_configured_at: string | null;
  rules_document_url: string | null;
  season_year: number;
  status: "active" | "completed" | "upcoming";
};

export type ParticipantPickCountRow = {
  race_id: number;
  user_id: string;
};

export type ResultRow = {
  driver_id: number;
  id: number;
  points: number;
  race_id: number;
};

export type PickSummaryRow = {
  average_speed: number | string;
  driver_group1_id: number;
  driver_group2_id: number;
  driver_group3_id: number;
  driver_group4_id: number;
  driver_group5_id: number;
  driver_group6_id: number;
  driver_group7_id: number | null;
  driver_group8_id: number | null;
  race_id: number;
  user_id: string;
};

export type RaceDriverGroupRow = {
  driver_id: number;
  group_number: number;
  qualifying_position: number | null;
  race_id: number;
};

export type FeedbackItemRow = {
  category: string;
  created_at: string;
  details: string;
  feedback_type: string;
  id: number;
  resolved_at: string | null;
  status: "in_review" | "new" | "resolved";
  user_id: string;
};

export type HealthRaceRow = {
  field_frozen_at: string | null;
  id: number;
  pick_format: RacePickFormat;
  pick_window_key: string;
  qualifying_start_at: string;
  race_date: string;
  race_name: string;
  results_status: "draft" | "published";
  round_number: number;
  season_id: number;
};

export type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export type AdminTab = AdminWorkspaceTab;

export type ScoringAuditDriverCell = {
  driverName: string | null;
  groupNumber: number;
  points: number | null;
};

export type ScoringAuditRow = {
  averageSpeed: number | null;
  driverCells: ScoringAuditDriverCell[];
  points: number;
  rank: number;
  submittedPick: boolean;
  teamName: string;
  tiebreakDelta: number | null;
  userId: string;
};

export type ScoringAudit = {
  groupCount: number;
  highestPossibleScore: number;
  lowestPossibleScore: number;
  noPickCount: number;
  officialWinningAverageSpeed: number | null;
  pickFormat: RacePickFormat;
  raceDate: string;
  raceId: number;
  raceName: string;
  resultCount: number;
  resultsStatus: "draft" | "published";
  rows: ScoringAuditRow[];
  submittedPickCount: number;
  winnerTeamName: string | null;
};

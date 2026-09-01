export type ProfileRow = {
  full_name: string | null;
  id: string;
  is_active?: boolean;
  role: "admin" | "participant";
  team_name: string | null;
};

const hasText = (value: string | null | undefined): boolean =>
  typeof value === "string" && value.trim().length > 0;

export function isProfileComplete(profile: ProfileRow | null | undefined): boolean {
  if (!profile) {
    return false;
  }

  return (
    hasText(profile.full_name) &&
    hasText(profile.team_name)
  );
}

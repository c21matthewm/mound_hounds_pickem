export type ProfileRow = {
  full_name: string | null;
  id: string;
  phone_carrier: string | null;
  phone_number: string | null;
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
    hasText(profile.team_name) &&
    hasText(profile.phone_number) &&
    hasText(profile.phone_carrier)
  );
}

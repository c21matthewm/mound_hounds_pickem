export const participantFirstName = (fullName: string | null | undefined): string | null => {
  const normalized = fullName?.trim();
  if (!normalized) {
    return null;
  }

  return normalized.split(/\s+/)[0] ?? null;
};

export const participantLeaderboardLabel = (
  fullName: string | null | undefined,
  teamName: string
): string => {
  const firstName = participantFirstName(fullName);
  return firstName ? `${firstName} - ${teamName}` : teamName;
};

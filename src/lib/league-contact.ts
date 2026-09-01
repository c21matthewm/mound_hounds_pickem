const DEFAULT_LEAGUE_ADMIN_EMAIL = "indymoundhounds@gmail.com";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const leagueAdminEmail = (): string => {
  const configuredEmail = process.env.LEAGUE_ADMIN_EMAIL?.trim();
  return configuredEmail && EMAIL_PATTERN.test(configuredEmail)
    ? configuredEmail
    : DEFAULT_LEAGUE_ADMIN_EMAIL;
};

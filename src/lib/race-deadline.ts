/** Rounded up so a remaining fraction of a minute never reads as already locked. */
export function raceDeadlineLabel(deadline: string, now: number): string {
  const deadlineTime = Date.parse(deadline);
  if (!Number.isFinite(deadlineTime)) return "Deadline unavailable";
  if (deadlineTime <= now) return "Picks locked";
  const minutes = Math.ceil((deadlineTime - now) / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const remainder = minutes % 60;
  const remaining = [days ? `${days}d` : "", hours ? `${hours}h` : "", remainder ? `${remainder}m` : ""].filter(Boolean).join(" ");
  return `${remaining} until picks lock`;
}

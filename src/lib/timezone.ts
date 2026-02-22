export const LEAGUE_TIME_ZONE = "America/Indiana/Indianapolis";

const DATETIME_LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const OFFSET_PATTERN = /^(?:GMT|UTC)([+-])(\d{1,2})(?::?(\d{2}))?$/;

type DateTimeParts = {
  day: number;
  hour: number;
  minute: number;
  month: number;
  year: number;
};

const localFormatter = new Intl.DateTimeFormat("en-US", {
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
  minute: "2-digit",
  month: "2-digit",
  timeZone: LEAGUE_TIME_ZONE,
  year: "numeric"
});

const offsetFormatter = new Intl.DateTimeFormat("en-US", {
  day: "2-digit",
  hour: "2-digit",
  hour12: false,
  minute: "2-digit",
  month: "2-digit",
  second: "2-digit",
  timeZone: LEAGUE_TIME_ZONE,
  timeZoneName: "shortOffset",
  year: "numeric"
});

const yearFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: LEAGUE_TIME_ZONE,
  year: "numeric"
});

const parseLocalDateTimeParts = (value: string): DateTimeParts | null => {
  const match = DATETIME_LOCAL_PATTERN.exec(value);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute)
  ) {
    return null;
  }

  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    return null;
  }

  const dayProbe = new Date(Date.UTC(year, month - 1, day));
  const validDay =
    dayProbe.getUTCFullYear() === year &&
    dayProbe.getUTCMonth() === month - 1 &&
    dayProbe.getUTCDate() === day;

  if (!validDay) {
    return null;
  }

  return { day, hour, minute, month, year };
};

const offsetMinutesInLeagueTimeZone = (date: Date): number | null => {
  const zonePart = offsetFormatter
    .formatToParts(date)
    .find((part) => part.type === "timeZoneName")?.value;

  if (!zonePart) {
    return null;
  }

  const match = OFFSET_PATTERN.exec(zonePart);
  if (!match) {
    return null;
  }

  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3] ?? "0");
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
    return null;
  }

  return sign * (hours * 60 + minutes);
};

const formatAsDateTimeLocal = (date: Date): string => {
  const values = new Map<string, string>();

  localFormatter.formatToParts(date).forEach((part) => {
    if (part.type === "year" || part.type === "month" || part.type === "day" || part.type === "hour" || part.type === "minute") {
      values.set(part.type, part.value);
    }
  });

  const year = values.get("year");
  const month = values.get("month");
  const day = values.get("day");
  const hour = values.get("hour");
  const minute = values.get("minute");

  if (!year || !month || !day || !hour || !minute) {
    return "";
  }

  return `${year}-${month}-${day}T${hour}:${minute}`;
};

export const parseLeagueDateTimeLocalInput = (value: string): string | null => {
  const parts = parseLocalDateTimeParts(value);
  if (!parts) {
    return null;
  }

  const localAsUtcEpoch = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0, 0);
  const firstOffset = offsetMinutesInLeagueTimeZone(new Date(localAsUtcEpoch));
  if (firstOffset === null) {
    return null;
  }

  let resolvedEpoch = localAsUtcEpoch - firstOffset * 60_000;
  const secondOffset = offsetMinutesInLeagueTimeZone(new Date(resolvedEpoch));
  if (secondOffset === null) {
    return null;
  }

  if (secondOffset !== firstOffset) {
    resolvedEpoch = localAsUtcEpoch - secondOffset * 60_000;
  }

  const resolvedDate = new Date(resolvedEpoch);
  if (formatAsDateTimeLocal(resolvedDate) !== value) {
    return null;
  }

  return resolvedDate.toISOString();
};

export const getLeagueYear = (referenceDate: Date = new Date()): number => {
  const yearText = yearFormatter.format(referenceDate);
  const parsedYear = Number(yearText);
  return Number.isInteger(parsedYear) ? parsedYear : referenceDate.getUTCFullYear();
};

export const getLeagueSeasonDateRange = (
  seasonYear: number = getLeagueYear()
): { seasonEndExclusiveIso: string; seasonStartIso: string; seasonYear: number } => {
  const seasonStartIso = parseLeagueDateTimeLocalInput(`${seasonYear}-01-01T00:00`);
  const seasonEndExclusiveIso = parseLeagueDateTimeLocalInput(`${seasonYear + 1}-01-01T00:00`);

  if (!seasonStartIso || !seasonEndExclusiveIso) {
    throw new Error("Failed to compute league season date range.");
  }

  return {
    seasonEndExclusiveIso,
    seasonStartIso,
    seasonYear
  };
};

export const formatLeagueDateTime = (
  value: string,
  options: Omit<Intl.DateTimeFormatOptions, "timeZone"> = { dateStyle: "medium", timeStyle: "short" }
): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: LEAGUE_TIME_ZONE }).format(date);
};

export const formatLeagueDateTimeLocalInput = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return formatAsDateTimeLocal(date);
};

import { MOUND_HOUND_IMAGE_PATH } from "@/lib/branding";
import { pickWindowDisplayName } from "@/lib/pick-windows";
import { pickLockAtForRace } from "@/lib/race-format";
import type { ReminderWindow } from "@/lib/reminder-windows";
import { formatLeagueDateTime } from "@/lib/timezone";

export type PickReminderRace = {
  id: number;
  pick_format: string | null;
  pick_window_key: string;
  qualifying_start_at: string;
  race_date: string;
  race_name: string;
  round_number: number;
  season_id: number;
};

type PickReminderMessageInput = {
  missingRaces: PickReminderRace[];
  recipientName?: string | null;
  reminderWindow: ReminderWindow;
  races: PickReminderRace[];
  siteUrl: string;
  testMode?: boolean;
};

export type PickReminderMessage = {
  html: string;
  smsText: string;
  subject: string;
  text: string;
};

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const firstNameFrom = (value: string | null | undefined): string | null => {
  const normalized = value?.trim();
  return normalized ? normalized.split(/\s+/)[0] : null;
};

export const buildPickReminderMessage = ({
  missingRaces,
  races,
  recipientName,
  reminderWindow,
  siteUrl,
  testMode = false
}: PickReminderMessageInput): PickReminderMessage => {
  if (races.length === 0 || missingRaces.length === 0) {
    throw new Error("A reminder message requires a race and at least one missing form.");
  }

  const race = races[0];
  const pickDeadlineText = formatLeagueDateTime(pickLockAtForRace(race), {
    dateStyle: "full",
    timeStyle: "short"
  });
  const normalizedSiteUrl = siteUrl.endsWith("/") ? siteUrl.slice(0, -1) : siteUrl;
  const picksUrl = `${normalizedSiteUrl}/picks`;
  const logoUrl = `${normalizedSiteUrl}${MOUND_HOUND_IMAGE_PATH}`;
  const isFinalReminder = reminderWindow.key === "4h";
  const weekendName = pickWindowDisplayName(races, race.race_name);
  const subjectRaceName = weekendName.replace(/[\r\n]+/g, " ").trim();
  const recipientFirstName = firstNameFrom(recipientName);
  const greeting = recipientFirstName ? `Hi ${recipientFirstName},` : "Hello,";
  const missingSummary =
    missingRaces.length === races.length
      ? `You still need to submit ${races.length === 1 ? "your race form" : "both race forms"}.`
      : `You still need to submit your picks for ${missingRaces[0].race_name}.`;
  const intro = isFinalReminder
    ? "This is your final reminder to submit your picks."
    : "This is your two-day reminder to submit your picks.";
  const baseSubject = isFinalReminder
    ? `[Mound Hounds Pick'em] Final reminder: ${subjectRaceName}`
    : `[Mound Hounds Pick'em] 2-day reminder: ${subjectRaceName}`;
  const subject = testMode ? `[TEST] ${baseSubject}` : baseSubject;
  const raceLines = missingRaces.map(
    (missingRace) => `- R${missingRace.round_number}: ${missingRace.race_name}`
  );
  const plainLines = [
    ...(testMode
      ? ["TEST EMAIL - No participant reminder history was changed.", ""]
      : []),
    greeting,
    "",
    intro,
    "",
    races.length > 1 ? "Missing doubleheader forms:" : `Race: ${race.race_name}`,
    ...(races.length > 1 ? raceLines : []),
    `Pick deadline: ${pickDeadlineText} (Indianapolis time)`,
    "",
    missingSummary,
    `Open the Pick'em form: ${picksUrl}`,
    "",
    "If the event schedule changes, the deadline shown in the app is the current deadline.",
    "Good luck and enjoy the race weekend!"
  ];
  const text = plainLines.join("\n");
  const smsText = [
    `Mound Hounds Pick'em reminder (${reminderWindow.label}):`,
    weekendName,
    missingRaces.length > 1
      ? "Both race forms are needed."
      : `Missing: ${missingRaces[0].race_name}.`,
    `Deadline: ${pickDeadlineText} (Indianapolis time).`,
    `Submit: ${picksUrl}`
  ].join(" ");
  const escapedRaceRows = missingRaces
    .map(
      (missingRace) =>
        `<tr><td style="padding:5px 0;color:#334155;font-size:14px;line-height:20px;">` +
        `<strong>R${missingRace.round_number}</strong> &middot; ${escapeHtml(missingRace.race_name)}</td></tr>`
    )
    .join("");
  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f1f5f9;color:#0f172a;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border:1px solid #cbd5e1;border-radius:8px;overflow:hidden;">
            <tr>
              <td style="padding:20px 24px;background:#0f172a;color:#ffffff;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  <tr>
                    <td width="58" valign="middle"><img src="${escapeHtml(logoUrl)}" alt="Mound Hounds" width="48" height="48" style="display:block;border:0;border-radius:6px;object-fit:contain;" /></td>
                    <td valign="middle" style="font-size:18px;font-weight:700;line-height:24px;">Mound Hounds Pick'em</td>
                  </tr>
                </table>
              </td>
            </tr>
            ${testMode ? '<tr><td style="padding:10px 24px;background:#fef3c7;color:#92400e;font-size:13px;font-weight:700;">TEST EMAIL &middot; Participant reminder history was not changed</td></tr>' : ""}
            <tr>
              <td style="padding:24px;">
                <p style="margin:0 0 16px;font-size:15px;line-height:22px;">${escapeHtml(greeting)}</p>
                <h1 style="margin:0 0 10px;font-size:22px;line-height:28px;color:#0f172a;">${escapeHtml(intro)}</h1>
                <p style="margin:0 0 18px;color:#475569;font-size:15px;line-height:22px;">${escapeHtml(missingSummary)}</p>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 20px;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;">
                  <tr><td style="padding:14px 0 4px;color:#64748b;font-size:11px;font-weight:700;text-transform:uppercase;">${races.length > 1 ? "Missing race forms" : "Race"}</td></tr>
                  ${races.length > 1 ? escapedRaceRows : `<tr><td style="padding:4px 0 14px;color:#0f172a;font-size:15px;font-weight:700;line-height:22px;">${escapeHtml(race.race_name)}</td></tr>`}
                  <tr><td style="padding:12px 0 4px;border-top:1px solid #e2e8f0;color:#64748b;font-size:11px;font-weight:700;text-transform:uppercase;">Pick deadline</td></tr>
                  <tr><td style="padding:4px 0 14px;color:#0f172a;font-size:15px;font-weight:700;line-height:22px;">${escapeHtml(pickDeadlineText)} <span style="font-weight:400;color:#64748b;">(Indianapolis time)</span></td></tr>
                </table>
                <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 20px;">
                  <tr><td style="border-radius:6px;background:#0369a1;"><a href="${escapeHtml(picksUrl)}" style="display:inline-block;padding:12px 18px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;">Open Pick'em Form</a></td></tr>
                </table>
                <p style="margin:0 0 8px;color:#64748b;font-size:12px;line-height:18px;">If the event schedule changes, the deadline shown in the app is the current deadline.</p>
                <p style="margin:0;color:#475569;font-size:14px;line-height:21px;">Good luck and enjoy the race weekend!</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { html, smsText, subject, text };
};

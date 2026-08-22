import { describe, expect, it } from "vitest";
import {
  buildPickReminderMessage,
  type PickReminderRace
} from "@/lib/pick-reminder-message";
import { getReminderWindowByType } from "@/lib/reminder-windows";

const saturdayRace: PickReminderRace = {
  id: 14,
  pick_format: "standard",
  pick_window_key: "doubleheader-window",
  qualifying_start_at: "2027-07-24T14:00:00.000Z",
  race_date: "2027-07-24T20:00:00.000Z",
  race_name: "Saturday Grand Prix",
  round_number: 14,
  season_id: 2027
};

const sundayRace: PickReminderRace = {
  ...saturdayRace,
  id: 15,
  race_date: "2027-07-25T20:00:00.000Z",
  race_name: "Sunday Grand Prix",
  round_number: 15
};

describe("pick reminder email template", () => {
  it("creates personalized HTML and plain-text two-day reminders", () => {
    const message = buildPickReminderMessage({
      missingRaces: [saturdayRace],
      races: [saturdayRace],
      recipientName: "Jordan Example",
      reminderWindow: getReminderWindowByType("2d"),
      siteUrl: "https://moundhoundspickem.app"
    });

    expect(message.subject).toContain("2-day reminder: Saturday Grand Prix");
    expect(message.subject).not.toContain("[TEST]");
    expect(message.text).toContain("Hi Jordan,");
    expect(message.text).not.toContain("TEST EMAIL");
    expect(message.text).toContain("the deadline shown in the app is the current deadline");
    expect(message.html).toContain("Open Pick'em Form");
    expect(message.html).not.toContain("Participant reminder history was not changed");
    expect(message.html).toContain("https://moundhoundspickem.app/picks");
    expect(message.html).toContain("/images/branding/mound-hound.webp");
  });

  it("shows only the missing race for a partially completed doubleheader", () => {
    const message = buildPickReminderMessage({
      missingRaces: [sundayRace],
      races: [saturdayRace, sundayRace],
      reminderWindow: getReminderWindowByType("2d"),
      siteUrl: "https://moundhoundspickem.app/"
    });

    expect(message.subject).toContain("2-day reminder: Doubleheader weekend");
    expect(message.text).toContain("R15: Sunday Grand Prix");
    expect(message.text).not.toContain("R14: Saturday Grand Prix");
    expect(message.html).toContain("R15");
    expect(message.html).not.toContain("R14");
  });

  it("marks administrator test messages without changing participant wording", () => {
    const message = buildPickReminderMessage({
      missingRaces: [saturdayRace],
      races: [saturdayRace],
      reminderWindow: getReminderWindowByType("4h"),
      siteUrl: "https://moundhoundspickem.app",
      testMode: true
    });

    expect(message.subject).toMatch(/^\[TEST\]/);
    expect(message.text).toContain("No participant reminder history was changed");
    expect(message.html).toContain("Participant reminder history was not changed");
  });

  it("escapes race and participant text in HTML output", () => {
    const message = buildPickReminderMessage({
      missingRaces: [{ ...saturdayRace, race_name: '<script>alert("race")</script>' }],
      races: [{ ...saturdayRace, race_name: '<script>alert("race")</script>' }],
      recipientName: "<b>Jordan</b>",
      reminderWindow: getReminderWindowByType("4h"),
      siteUrl: "https://moundhoundspickem.app"
    });

    expect(message.html).not.toContain("<script>");
    expect(message.html).not.toContain("<b>Jordan</b>");
    expect(message.html).toContain("&lt;script&gt;");
    expect(message.html).toContain("&lt;b&gt;Jordan&lt;/b&gt;");
  });
});

import { createElement, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { RaceScheduleRefresh } from "@/components/race-schedule-refresh";
import { HallOfFameYearSelect } from "@/components/hall-of-fame-year-select";
import { PicksRaceSelect } from "@/components/picks-race-select";
import { AuthenticatedPageShell } from "@/components/authenticated-page-shell";
import { MobileActionDock } from "@/components/mobile-action-dock";
import { PwaProvider } from "@/components/pwa-provider";
import { InstallAppControls } from "@/components/install-app-controls";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { PickemForm } from "@/components/pickem-form";
import { PickSubmissionSnapshot } from "@/components/pick-submission-snapshot";
import { StandingsTable } from "@/components/standings-table";
import { PicksByRaceTable } from "@/components/picks-by-race-table";
import "@/app/globals.css";

const root = createRoot(document.getElementById("root"));
let sceneVersion = 0;
window.showPickScene = (name) => {
  const count = name.startsWith("indy") ? 8 : 6;
  const firstSubmission = name === "first" || name === "indy-first";
  const groups = Array.from({ length: count }, (_, index) => ({
    groupNumber: index + 1, isTopGroup: index < 5,
    drivers: [1, 2].map(offset => ({ id: index * 2 + offset, driverName: `Fixture G${index + 1} Driver ${offset}`, imageUrl: null, championshipPoints: 0 }))
  }));
  const savedSelection = Object.fromEntries(groups.map(group => [group.groupNumber, firstSubmission ? null : group.drivers[0].id]));
  const props = {
    action: async form => {
      window.fixtureCalls.push(Object.fromEntries(form));
      if (name === "stalled") await new Promise(() => {});
    },
    canSubmit: name !== "locked", draftOwnerId: "fixture-user",
    existingAverageSpeed: firstSubmission ? "" : "135.500",
    existingSavedAt: firstSubmission ? null : "2027-05-01T12:00:00Z",
    groups, picksLocked: name === "locked", raceId: 1, savedSelection
  };
  root.render(createElement(PwaProvider, { key: ++sceneVersion }, createElement(AuthenticatedPageShell, { eyebrow: "Race picks", title: "Pick'em Form" }, createElement(PickemForm, props))));
};

window.showStandingsScene = (hasTeam) => {
  const rows = Array.from({ length: 55 }, (_, index) => ({
    change: 0,
    currentStanding: index === 30 ? 30 : index + 1,
    displayName: index === 29 ? "Zulu Racing" : `Fixture Team ${index + 1}`,
    racePointsByRaceId: { 1: 100 - index },
    totalPoints: 100 - index,
    userId: `team-${index}`
  }));
  root.render(createElement(
    AuthenticatedPageShell,
    { eyebrow: "League Data", title: "Leaderboard" },
    createElement(StandingsTable, {
      currentUserId: hasTeam ? "team-29" : "unranked-team",
      raceColumns: [{ raceId: 1, raceName: "Fixture race", roundNumber: 1 }],
      rows,
      seasonYear: 2027
    })
  ));
};

window.showRacePicksScene = (resultsPosted) => {
  const rows = [true, false].map((submittedPick, index) => ({
    averageSpeed: submittedPick ? 180 : null,
    displayName: submittedPick ? "Submitted Racing" : "Missing Racing",
    drivers: Array.from({ length: 8 }, (_, group) => ({
      driverName: submittedPick ? `Driver ${group + 1}` : null,
      points: resultsPosted ? (submittedPick ? 5 : 2) : null
    })),
    rank: resultsPosted ? index + 1 : null,
    submittedPick,
    teamName: submittedPick ? "Submitted Racing" : "Missing Racing",
    totalPoints: resultsPosted ? (submittedPick ? 40 : 16) : null,
    userId: `team-${index}`
  }));
  root.render(createElement(
    AuthenticatedPageShell,
    { eyebrow: "League Data", title: "Leaderboard" },
    createElement(PicksByRaceTable, { officialWinningAverageSpeed: 180, resultsPosted, rows })
  ));
};

function LeaderboardSelectors() {
  const [selection, setSelection] = useState({ raceId: 7, year: 2026 });

  useEffect(() => {
    window.fixtureNavigate = (href, options) => new Promise((resolve) => {
      window.fixtureCalls.push({ href, options });
      const params = new URLSearchParams(href.split("?")[1]);
      window.finishFixtureNavigation = () => {
        setSelection((previous) => ({
          raceId: Number(params.get("race_id")) || previous.raceId,
          year: Number(params.get("year")) || previous.year
        }));
        resolve();
      };
    });
    return () => { delete window.fixtureNavigate; };
  }, []);

  return createElement("div", null,
    createElement(HallOfFameYearSelect, { selectedYear: selection.year, years: [2026, 2025] }),
    createElement(PicksRaceSelect, {
      selectedRaceId: selection.raceId,
      races: [
        { raceId: 7, raceName: "Fictional race", roundNumber: 1 },
        { raceId: 8, raceName: "Another race", roundNumber: 2 }
      ]
    })
  );
}

window.showPwaScene = () => {
  root.render(createElement(PwaProvider, { key: ++sceneVersion },
    createElement("main", null,
      createElement(InstallAppControls),
      createElement("form", { onSubmit: event => { event.preventDefault(); window.fixtureCalls.push({ action: "generic" }); } },
        createElement(SubmitButton, null, "Save changes"),
        createElement(ConfirmSubmitButton, { confirmMessage: "Apply?" }, "Confirm changes"),
        createElement("button", { type: "submit" }, "Plain submit")
      ),
      createElement(LeaderboardSelectors)
    )
  ));
};

window.showFrameScene = () => {
  root.render(createElement(PwaProvider, { key: ++sceneVersion },
    createElement(AuthenticatedPageShell, { eyebrow: "Race picks", title: "Pick'em Form" },
      createElement("p", null, "Fictional league content"),
      createElement(MobileActionDock, null, createElement("button", { type: "button", className: "min-h-11" }, "Save draft"))
    )
  ));
};

window.showRefreshScene = () => {
  root.render(createElement(PwaProvider, { key: ++sceneVersion }, createElement("main", null,
    createElement("p", null, "Schedule refresh fixture"),
    createElement(RaceScheduleRefresh, { pickLockAt: new Date(Date.now()+1800000).toISOString(), raceStartAt: new Date(Date.now()+3600000).toISOString() })
  )));
};

window.showReceiptScene = (saved, lockedDraftKey) => {
  root.render(createElement(PwaProvider, { key: ++sceneVersion },
    createElement(AuthenticatedPageShell, { eyebrow: "Race picks", title: "Pick'em Form" },
      createElement(RaceScheduleRefresh, {
        lockedDraftKey, pickLockAt: "2027-05-01T14:00:00Z", raceStartAt: "2027-05-01T14:00:00Z", raceId: 1
      }),
      createElement(PickSubmissionSnapshot, {
        lockedRaceId: 1,
        latestSavedAt: saved ? "2027-05-01T12:00:00Z" : null,
        savedAverageSpeed: saved ? "138.001" : null,
        savedPicks: saved ? Array.from({ length: 8 }, (_, index) => ({
          driverName: "Fixture driver with a long name " + (index + 1),
          groupNumber: index + 1
        })) : []
      })
    )
  ));
};

window.showRaceStartScene = () => {
  const raceStartAt = new Date(Date.now() + 20_000).toISOString();
  root.render(createElement(PwaProvider, { key: ++sceneVersion }, createElement("main", null,
    createElement("p", null, "Race start fixture"),
    createElement(RaceScheduleRefresh, { pickLockAt: raceStartAt, raceStartAt, raceId: 1 })
  )));
};

import { createElement } from "react";
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
import "@/app/globals.css";

const root = createRoot(document.getElementById("root"));
let sceneVersion = 0;
window.showPickScene = (name) => {
  const count = name === "indy" ? 8 : 6;
  const groups = Array.from({ length: count }, (_, index) => ({
    groupNumber: index + 1, isTopGroup: index < 5,
    drivers: [1, 2].map(offset => ({ id: index * 2 + offset, driverName: `Fixture G${index + 1} Driver ${offset}`, imageUrl: null, championshipPoints: 0 }))
  }));
  const savedSelection = Object.fromEntries(groups.map(group => [group.groupNumber, name === "first" ? null : group.drivers[0].id]));
  const props = {
    action: async form => { window.fixtureCalls.push(Object.fromEntries(form)); },
    canSubmit: name !== "locked", draftOwnerId: "fixture-user",
    existingAverageSpeed: name === "first" ? "" : "135.500",
    existingSavedAt: name === "first" ? null : "2027-05-01T12:00:00Z",
    groups, picksLocked: name === "locked", raceId: 1, savedSelection
  };
  root.render(createElement(PwaProvider, { key: ++sceneVersion }, createElement(AuthenticatedPageShell, { eyebrow: "Race picks", title: "Pick'em Form" }, createElement(PickemForm, props))));
};

window.showPwaScene = () => {
  root.render(createElement(PwaProvider, { key: ++sceneVersion },
    createElement("main", null,
      createElement(InstallAppControls),
      createElement("form", { onSubmit: event => { event.preventDefault(); window.fixtureCalls.push({ action: "generic" }); } },
        createElement(SubmitButton, null, "Save changes"),
        createElement(ConfirmSubmitButton, { confirmMessage: "Apply?" }, "Confirm changes"),
        createElement("button", { type: "submit" }, "Plain submit")
      ),
      createElement(HallOfFameYearSelect, { selectedYear: 2026, years: [2026, 2025] }),
      createElement(PicksRaceSelect, { selectedRaceId: 7, races: [{ raceId: 7, raceName: "Fictional race", roundNumber: 1 }] })
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

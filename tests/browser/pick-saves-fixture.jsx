import { createElement } from "react";
import { createRoot } from "react-dom/client";
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
  root.render(createElement("main", { key: ++sceneVersion }, createElement(PickemForm, props)));
};

import { describe, expect, it } from "vitest";
import { missingPickParticipants, selectRaceWeekPhase, raceFieldFreezeState } from "@/lib/admin-race-week";
import type { RaceRow } from "@/app/admin/admin-types";
const now = Date.parse("2027-05-01T12:00:00Z");
const race = {pick_format:"standard", qualifying_start_at:"2027-05-02T12:00:00Z", race_date:"2027-05-03T12:00:00Z", results_status:"draft", field_frozen_at:null} as RaceRow;
describe("Race Week workflow", () => {
  it("allows explicit stages and selects a useful default from race state", () => {
    expect(selectRaceWeekPhase(undefined, null, now)).toBe("preparation");
    expect(selectRaceWeekPhase("invalid", race, now)).toBe("preparation");
    expect(selectRaceWeekPhase(undefined, {...race,field_frozen_at:"2027-05-01T00:00:00Z"}, now)).toBe("picks");
    expect(selectRaceWeekPhase(undefined, race, Date.parse(race.qualifying_start_at))).toBe("results");
    expect(selectRaceWeekPhase(undefined, {...race,results_status:"published"}, now)).toBe("winner");
    expect(selectRaceWeekPhase("results", {...race,results_status:"published"}, now)).toBe("results");
  });
  it.each(["preparation", "picks", "results", "winner"])("returns the no-schedule state for a bookmarked %s stage", phase => {
    expect(selectRaceWeekPhase(phase, null, now)).toBe("preparation");
    // Stages remain selectable when an actual race is available.
    expect(selectRaceWeekPhase(phase, race, now)).toBe(phase);
  });
  it("uses the Indianapolis 500 race deadline, not qualifying, for the default stage", () => {
    expect(selectRaceWeekPhase(undefined, {...race,pick_format:"indy_500",field_frozen_at:"2027-04-30T00:00:00Z"}, Date.parse(race.qualifying_start_at))).toBe("picks");
  });
  it("requires both doubleheader forms and ignores duplicates or other-race submissions", () => {
    const participants = [{id:"complete"},{id:"partial"},{id:"missing"}];
    const picks = [{user_id:"complete",race_id:1},{user_id:"complete",race_id:2},{user_id:"partial",race_id:1},{user_id:"partial",race_id:1},{user_id:"missing",race_id:99}];
    expect(missingPickParticipants(participants,[1,2],picks).map(p=>p.id)).toEqual(["partial","missing"]);
    expect(missingPickParticipants(participants,[],picks)).toEqual([]);
  });
});

describe("field readiness hints",()=>{
 const first={...race,id:1,season_id:1,round_number:1,pick_window_key:"shared",is_archived:false};
 const second={...first,id:2,round_number:2};
 const third={...first,id:3,round_number:3,pick_window_key:"next"};
 it("allows a complete shared window during its opening period",()=>{expect(raceFieldFreezeState(second,[first,second],now).disabled).toBe(false);});
 it("does not treat only one frozen race as a complete doubleheader snapshot",()=>{expect(raceFieldFreezeState(second,[{...first,field_frozen_at:"2027-05-01T00:00:00Z"},second],now).disabled).toBe(false);expect(raceFieldFreezeState(second,[first,second].map(r=>({...r,field_frozen_at:"2027-05-01T00:00:00Z"})),now).message).toContain("saved for every race");});
 it("closes the second-race button when the first deadline has passed",()=>{expect(raceFieldFreezeState(second,[{...first,qualifying_start_at:"2027-04-30T12:00:00Z"},second],now).message).toContain("closed");});
 it("waits for every prior doubleheader result, even if one is published",()=>{expect(raceFieldFreezeState(third,[{...first,results_status:"published"},second,third],now).message).toContain("previous pick window");expect(raceFieldFreezeState(third,[{...first,results_status:"published"},{...second,results_status:"published"},third],now).disabled).toBe(false);});
 it("waits for the six-day opener and rejects invalid schedules",()=>{expect(raceFieldFreezeState(first,[first],now-8*86400000).message).toContain("six days");expect(raceFieldFreezeState(first,[],now).disabled).toBe(true);expect(raceFieldFreezeState(first,[first,{...second,round_number:1}],now).message).toContain("could not be verified");});
});

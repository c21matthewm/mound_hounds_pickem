import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AdminRaceFieldPreview } from "@/components/admin-race-field-preview";
import type { DriverRow, RaceRow } from "@/app/admin/admin-types";
import { raceDeadlineLabel } from "@/lib/race-deadline";
const driver = {id:1,driver_name:"Retired driver",group_number:6,is_active:false} as DriverRow;
const race = {id:2,pick_format:"standard",field_frozen_at:"2027-05-01T00:00:00Z"} as RaceRow;
describe("race field preview",()=>{
 it("uses saved group membership even when a driver changes group or becomes inactive",()=>{
  const html=renderToStaticMarkup(<AdminRaceFieldPreview race={race} drivers={[driver]} snapshot={[{race_id:2,driver_id:1,group_number:1,qualifying_position:null}]} />);
  expect(html).toContain("View saved pick field");expect(html).toContain("Retired driver");expect(html.indexOf("Retired driver")).toBeLessThan(html.indexOf("Group 2"));
 });
 it("does not fall back to the current roster when a saved field is missing",()=>{
  const html=renderToStaticMarkup(<AdminRaceFieldPreview race={race} drivers={[{...driver,is_active:true}]} snapshot={[]} />);expect(html).toContain("No saved field rows");expect(html).not.toContain("Retired driver");
 });
 it("previews only active drivers before freezing and never substitutes standard groups for Indy qualifying",()=>{
  const html=renderToStaticMarkup(<AdminRaceFieldPreview race={{...race,field_frozen_at:null}} drivers={[driver,{...driver,id:2,driver_name:"Current driver",is_active:true}]} snapshot={[]} />);expect(html).toContain("Current driver");expect(html).not.toContain("Retired driver");
  expect(renderToStaticMarkup(<AdminRaceFieldPreview race={{...race,pick_format:"indy_500",field_frozen_at:null}} drivers={[driver]} snapshot={[]} />)).toContain("full Indianapolis 500 qualifying order");
 });
});
describe("deadline countdown",()=>{
 const now=Date.parse("2027-05-01T00:00:00Z");
 it.each([[1,"1m"],[60_000,"1m"],[61_000,"2m"],[3600_000,"1h"],[90060_000,"1d 1h 1m"]])("rounds %i milliseconds up for display",(remaining,label)=>{expect(raceDeadlineLabel(new Date(now+remaining).toISOString(),now)).toBe(`${label} until picks lock`);});
 it("switches exactly at the deadline and handles invalid values",()=>{expect(raceDeadlineLabel(new Date(now).toISOString(),now)).toBe("Picks locked");expect(raceDeadlineLabel("invalid",now)).toBe("Deadline unavailable");});
});

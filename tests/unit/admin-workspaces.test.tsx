import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import type { RaceRow, LeagueSeasonRow } from "@/app/admin/admin-types";
import { AdminRaceWeekWorkspace } from "@/components/admin-race-week-workspace";
import { AdminSeasonsWorkspace } from "@/components/admin-seasons-workspace";
import { AdminWorkspaceNav } from "@/components/admin-workspace-nav";
import { AdminParticipantsWorkspace } from "@/components/admin-participants-workspace";
import { AdminSystemHealth } from "@/components/admin-system-health";
import { parseAdminAuditQuery } from "@/lib/admin-audit-log";
import { EXPECTED_SCHEMA_VERSION } from "@/lib/supabase/schema-version";
const action = async () => {};
vi.mock("@/app/admin/season-closeout-actions",()=>({completeLeagueSeasonAction:async()=>{}}));
vi.mock("@/app/admin/rules-document-actions",()=>({uploadSeasonRulesDocumentAction:async()=>({status:"idle",message:""})}));
vi.mock("@/app/admin/participant-bulk-actions",()=>({bulkUpdateParticipantsAction:async()=>({ok:false,message:""})}));
vi.mock("next/navigation", () => ({useRouter: () => ({push: () => {}})}));
vi.mock("@/app/admin/admin-data", () => ({formatDateTime:(date:string)=>date.slice(0,16).replace("T"," "),formatDateTimeLocalInput:(date:string)=>date.slice(0,16)}));
vi.mock("@/app/admin/season-actions", () => ({activateLeagueSeasonAction:async()=>{},createLeagueSeasonAction:async()=>{},setLeagueSeasonInviteCodeAction:async()=>{},setLeagueSeasonRulesDocumentAction:async()=>{},updateParticipantAction:async()=>{}}));
vi.mock("@/app/admin/hall-of-fame-actions",()=>({finalizeHallOfFameSeasonAction:async()=>{}}));
vi.mock("@/app/admin/race-actions",()=>({correctPickWindowQualifyingStartAction:async()=>{},setRaceWinnerAction:async()=>{}}));
vi.mock("@/app/admin/result-actions",()=>({importIndy500QualifyingOrderAction:async()=>{}}));
vi.mock("@/app/admin/role-actions",()=>({updateParticipantRoleAction:async()=>{}}));
vi.mock("@/app/admin/race-week-actions",()=>({triggerFantasyWinnerJobAction:async()=>{},freezeRaceFieldAction:async()=>{}}));
vi.mock("@/app/admin/historical-hall-of-fame-actions",()=>({importHistoricalHallOfFameAction:async()=>({status:"idle",message:""})}));
const race = {id:11,season_id:2,round_number:1,race_name:"Long Beach Grand Prix – a long race name for narrow phone screens",pick_format:"standard",pick_window_key:"fixture",qualifying_start_at:"2027-04-01T12:00:00Z",race_date:"2027-04-02T12:00:00Z",results_status:"draft",field_frozen_at:null,winner_profile_id:null,winner_is_manual_override:false} as RaceRow;
const season = {id:2,season_year:2027,display_name:"2027 Mound Hounds Pick'em",status:"active",registration_code_configured_at:"2027-03-01T12:00:00Z",roster_configured_at:"2027-03-01T12:00:00Z",rules_document_url:null} as LeagueSeasonRow;
const participants = [{id:"admin",team_name:"The longest team name allowed for a participant in this league",full_name:"Fixture Organizer",role:"admin" as const,is_active:true}];
const nav = (tab: "race-week"|"seasons"|"participants"|"health") => <AdminWorkspaceNav activeTab={tab} />;
const health = <AdminSystemHealth activeSeasonYear={2027} capabilities={{items:[{name:"Season completion",installed:true}],issue:null}} appErrorInboxReady appErrorInboxIssue={null} appErrors={[]} auditLog={{query:parseAdminAuditQuery({}),rows:[],hasOlder:false,hasNewer:false,detail:null,error:null,detailError:null}} cleanupTestFlowDataAction={action} currentTime={Date.parse("2027-04-01T10:00:00Z")} emailEnabled={false} healthContract={{healthy:true,missing:[],version:EXPECTED_SCHEMA_VERSION}} jobEvents={[]} jobRuns={[]} openAppErrorCount={0} reminderRows={[]} resolveAppErrorAction={action} schemaVersion={EXPECTED_SCHEMA_VERSION} />;
const scenes = {
  preparation:<>{nav("race-week")}<AdminRaceWeekWorkspace drivers={[]} snapshot={[]} currentTime={Date.parse("2027-04-01T10:00:00Z")} race={race} races={[race]} phase="preparation" participants={participants} teamNameByProfileId={new Map()} /></>,
  winner:<>{nav("race-week")}<AdminRaceWeekWorkspace drivers={[]} snapshot={[]} currentTime={Date.parse("2027-04-01T10:00:00Z")} race={{...race,results_status:"published",winner_profile_id:"admin"}} races={[race]} phase="winner" participants={participants} teamNameByProfileId={new Map([["admin",participants[0].team_name]])} /></>,
  empty:<>{nav("race-week")}<AdminRaceWeekWorkspace drivers={[]} snapshot={[]} currentTime={Date.parse("2027-04-01T10:00:00Z")} race={null} races={[]} phase="preparation" participants={[]} teamNameByProfileId={new Map()} /></>,
  seasons:<>{nav("seasons")}<AdminSeasonsWorkspace activeSeason={season} seasons={[season,{...season,id:3,season_year:2028,display_name:"2028 season",status:"upcoming",roster_configured_at:null}]} archives={[{id:10,season_year:2026,champion_team_name:"Fixture Champion – A Long Winning Team Name",champion_total_points:2684,participant_count:78,race_count:18,finalized_at:"2026-09-13T12:00:00Z"}]} currentSeasonRaces={[]} canFinalizeSeason={false} canRefreshArchive={false} finalSeasonRace={undefined} unpublishedSeasonRaces={[]} siteOrigin="https://league.example" /></>,
  participants:<>{nav("participants")}<AdminParticipantsWorkspace activeSeasonYear={2027} currentAdminId="admin" participants={[{id:"admin",teamName:participants[0].team_name,fullName:"Fixture Organizer",email:"a-very-long-participant-email-address@example.test",isActive:true,pickCount:2,registered:true,role:"admin"}]} /></>,
  health:<>{nav("health")}{health}</>
};
describe("Admin workspace composition",()=>{
  it("separates weekly work from technical diagnostics and preserves the no-schedule next step",()=>{
    const prep=renderToStaticMarkup(scenes.preparation);
    expect(prep).toContain('aria-label="Race week stages"');expect(prep).toContain('aria-current="step"');
    expect(prep).toContain("Official qualifying time correction");expect(prep).not.toContain("Database contract needs attention");
    expect(renderToStaticMarkup(scenes.empty)).toContain("Open Seasons &amp; League");
    const system=renderToStaticMarkup(health);expect(system).toContain("System Health");expect(system).not.toContain("Reminder readiness");
  });
  it("puts season setup and archives together, with historical imports clearly separated from app finalization",()=>{
    const html=renderToStaticMarkup(scenes.seasons);expect(html).toContain("Import a historical season");expect(html).toContain("Season archives");expect(html).toContain("Share registration");expect(html).toContain("Configure roster");
  });
  it("keeps historical closeout separate from activating the next season",()=>{
    const archived={id:10,season_year:2026,champion_team_name:"Fixture champion",champion_total_points:100,participant_count:2,race_count:1,finalized_at:"2026-09-01T00:00:00Z"};
    const base={seasons:[],archives:[archived],currentSeasonRaces:[],canFinalizeSeason:false,canRefreshArchive:false,finalSeasonRace:undefined,unpublishedSeasonRaces:[],siteOrigin:"https://fixture.example"};
    const before=renderToStaticMarkup(<AdminSeasonsWorkspace {...base} activeSeason={{...season,season_year:2026}}/>);
    expect(before).toContain("Complete 2026 season");expect(before).toContain('name="archive_id"');
    const after=renderToStaticMarkup(<AdminSeasonsWorkspace {...base} activeSeason={null}/>);
    expect(after).toContain("The league is between seasons");expect(after).not.toContain("Complete 2026 season");
    const profile=renderToStaticMarkup(<AdminParticipantsWorkspace activeSeasonYear={null} activeSeasonId={null} currentAdminId="fixture" participants={[{id:"fixture",fullName:"Fixture Name",teamName:"Fixture Team",isActive:true,pickCount:0,registered:false,role:"admin"}]}/>);
    expect(profile).toContain("Historical season registrations remain unchanged");expect(profile).toContain('name="expected_season_id" value=""');
  });
  it("renders mobile review fixtures without application credentials or service calls",()=>{
    for(const [name,scene] of Object.entries(scenes)) {
      const html=renderToStaticMarkup(<main className="mx-auto min-w-0 max-w-7xl p-4 sm:p-6">{scene}</main>);
      expect(html).not.toContain("undefined");
      if(process.env.ADMIN_VISUAL_OUTPUT) {
        mkdirSync(process.env.ADMIN_VISUAL_OUTPUT,{recursive:true});
        writeFileSync(`${process.env.ADMIN_VISUAL_OUTPUT}/${name}.html`,html);
      }
    }
  });
});

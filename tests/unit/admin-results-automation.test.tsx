import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AppSupabaseClient } from "@/lib/supabase/types";
const rpc=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/results-automation-store",()=>({automationRpc:rpc}));
vi.mock("@/app/admin/results-automation-actions",()=>({configureResultsMonitorAction:async()=>{},publishStagedResultsAction:async()=>{},revalidateStagedResultsAction:async()=>{}}));
import { AdminResultsAutomation } from "@/components/admin-results-automation";
const race={id:1,race_name:"Fixture Grand Prix",race_date:"2027-09-06T18:00:00Z",field_frozen_at:"2027-09-05T12:00:00Z"};
const source={event_id:"fixture",session_id:"race",source_url:"https://www.indycar.com/results/ntt-indycar-series/2027/fixture/race",poll_after:null,next_poll_at:null,official_staged_at:null,monitor_enabled:true,last_checked_at:null,last_error_code:null};
const run={id:"00000000-0000-4000-8000-000000000001",source_status:"official",status:"READY_TO_PUBLISH",created_at:"2027-09-06T23:00:00Z",flags:[],preview:{rows:[],readyCount:27,expectedResultCount:27,winningAverageSpeed:170}};
const render=async(state:unknown)=>{rpc.mockResolvedValueOnce(state);return renderToStaticMarkup(await AdminResultsAutomation({supabase:{} as AppSupabaseClient,race}));};
describe("Admin official-results approval and monitoring feedback",()=>{
  it.each([
    {name:"clean official",status:"READY_TO_PUBLISH",finality:"official",flags:[],eligible:true,publish:true},
    {name:"flagged official",status:"READY_TO_PUBLISH",finality:"official",flags:[{code:"mapping",message:"Unmatched fixture driver"}],eligible:true,publish:false},
    {name:"provisional",status:"READY_TO_PUBLISH",finality:"provisional",flags:[],eligible:true,publish:false},
    {name:"unconfirmed",status:"NEEDS_REVIEW",finality:"unknown",flags:[],eligible:true,publish:false},
    {name:"superseded",status:"SUPERSEDED",finality:"official",flags:[],eligible:true,publish:false},
    {name:"published",status:"PUBLISHED",finality:"official",flags:[],eligible:true,publish:false},
    {name:"inactive season",status:"READY_TO_PUBLISH",finality:"official",flags:[],eligible:false,publish:false},
  ])("shows approval only for an eligible $name preview",async({status,finality,flags,eligible,publish})=>{
    const html=await render({source,can_monitor:eligible,runs:[{...run,status,source_status:finality,flags}]});
    expect(html.includes("Approve and publish")).toBe(publish);
    expect(html.includes("Recheck driver mapping")).toBe(!["SUPERSEDED","PUBLISHED"].includes(status));
  });
  it("does not promise continued polling when paused and explains delayed starts and failed worker setup",async()=>{
    const paused=await render({source:{...source,monitor_enabled:false},can_monitor:true,runs:[{...run,status:"NEEDS_REVIEW",source_status:"provisional"}]});
    expect(paused).toContain("Automatic checking is off for this race.");
    expect(paused).not.toContain("Automatic checks continue at 15-minute intervals.");
    const delayed=await render({source:{...source,poll_after:"2027-09-08T18:00:00Z",dispatch_error_code:"dispatch_auth"},can_monitor:true,runs:[]});
    expect(delayed).toContain("Checking can begin");
    expect(delayed).toContain("Check or renew the GitHub token in Supabase Vault.");
    expect(delayed).not.toContain(", 2½ hours after the scheduled start.");
  });
});

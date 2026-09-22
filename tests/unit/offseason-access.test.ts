import {beforeEach,describe,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({client:vi.fn(),active:vi.fn(),participation:vi.fn(),redirect:vi.fn()}));
vi.mock("@/lib/supabase/server",()=>({createServerSupabaseClient:m.client}));
vi.mock("@/lib/seasons",()=>({loadActiveLeagueSeason:m.active}));
vi.mock("@/lib/season-participation",()=>({loadSeasonParticipation:m.participation,isRegisteredForSeason:(p:{status:string}|null)=>p?.status==="registered"}));
vi.mock("next/navigation",()=>({redirect:m.redirect}));
import {requireAppUser} from "@/lib/authenticated-user";
beforeEach(()=>{vi.resetAllMocks();m.redirect.mockImplementation((path:string)=>{throw new Error(path);});const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{id:"fixture",full_name:"Fixture User",team_name:"Fixture Team",is_active:true,role:"participant"},error:null})};m.client.mockResolvedValue({auth:{getUser:async()=>({data:{user:{id:"fixture"}}})},from:()=>q});m.active.mockResolvedValue(null);m.participation.mockResolvedValue(null);});
describe("off-season access",()=>{
 it("allows signed-in pages to render their off-season state without asking for impossible registration",async()=>{const result=await requireAppUser({requireRegistration:true,requireSeasonDecision:true});expect(result.activeSeason).toBeNull();expect(m.participation).not.toHaveBeenCalled();expect(m.redirect).not.toHaveBeenCalled();});
 it("still requires a season decision once registration opens",async()=>{m.active.mockResolvedValue({id:27});await expect(requireAppUser({requireSeasonDecision:true})).rejects.toThrow("/season-registration");});
 it("still prevents picks for a declined active-season member",async()=>{m.active.mockResolvedValue({id:27});m.participation.mockResolvedValue({status:"declined"});await expect(requireAppUser({requireRegistration:true})).rejects.toThrow("Register%20for%20the%20active%20season");});
});

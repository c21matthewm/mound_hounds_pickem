import { beforeEach, describe, expect, it, vi } from "vitest";
import { freezeRaceFieldAction } from "@/app/admin/race-week-actions";
const m = vi.hoisted(() => ({auth:vi.fn(),rpc:vi.fn(),invalidate:vi.fn(),revalidate:vi.fn(),redirect:vi.fn(),report:vi.fn()}));
vi.mock("@/lib/admin",()=>({requireAdmin:m.auth}));
vi.mock("@/lib/admin-audit",()=>({recordAdminAudit:vi.fn()}));
vi.mock("@/lib/fantasy-winner",()=>({finalizeDueRaceWinners:vi.fn()}));
vi.mock("@/lib/job-runs",()=>({withJobRun:vi.fn()}));
vi.mock("@/lib/scoring-cache",()=>({invalidateScoringCache:m.invalidate}));
vi.mock("next/cache",()=>({revalidatePath:m.revalidate}));
vi.mock("@/app/admin/action-runtime",()=>({adminRedirect:m.redirect,reportAdminActionFailure:m.report,
 asText:(v:unknown)=>typeof v==="string"?v.trim():"",parsePositiveInteger:(v:string)=>/^[1-9][0-9]*$/.test(v)?Number(v):null}));
const form=(race="2",confirm="yes")=>{const f=new FormData();f.set("race_id",race);f.set("confirm_field_freeze",confirm);return f;};
beforeEach(()=>{vi.resetAllMocks();m.auth.mockResolvedValue({supabase:{rpc:m.rpc},user:{id:"admin"}});m.rpc.mockResolvedValue({data:{already_frozen:false},error:null});});
describe("manual field freezing",()=>{
 it("authorizes before validating or touching a field",async()=>{m.auth.mockRejectedValue(new Error("Forbidden"));await expect(freezeRaceFieldAction(form())).rejects.toThrow("Forbidden");expect(m.rpc).not.toHaveBeenCalled();});
 it.each([["bad","yes"],["0","yes"],["2",""]])("requires a selected race and confirmation (%s, %s)",async(id,confirmation)=>{await freezeRaceFieldAction(form(id,confirmation));expect(m.rpc).not.toHaveBeenCalled();expect(m.redirect).toHaveBeenCalledWith("error",expect.stringContaining("Confirm"),"race-week",id==="2"?2:null,"preparation");});
 it("dispatches only the selected race to the atomic operation and refreshes all pick/scoring views",async()=>{await freezeRaceFieldAction(form());expect(m.rpc).toHaveBeenCalledExactlyOnceWith("admin_freeze_race_field",{p_race_id:2});expect(m.invalidate).toHaveBeenCalledOnce();expect(m.revalidate.mock.calls.flat()).toEqual(["/admin","/dashboard","/picks","/leaderboard"]);expect(m.redirect).toHaveBeenCalledWith("message",expect.stringContaining("Participant picks"),"race-week",2,"preparation");});
 it("reports a previously frozen window without claiming a new snapshot",async()=>{m.rpc.mockResolvedValue({data:{already_frozen:true},error:null});await freezeRaceFieldAction(form());expect(m.redirect).toHaveBeenCalledWith("message",expect.stringContaining("already frozen"),"race-week",2,"preparation");});
 it.each(["PGRST202","42883"])("fails closed when its migration is absent (%s)",async code=>{m.rpc.mockResolvedValue({error:{code}});await freezeRaceFieldAction(form());expect(m.redirect).toHaveBeenCalledWith("error",expect.stringContaining("not configured"),"race-week",2,"preparation");expect(m.invalidate).not.toHaveBeenCalled();});
 it.each(["55P03","40P01","40001"])("makes a busy schedule or roster retryable (%s)",async code=>{m.rpc.mockResolvedValue({error:{code}});await freezeRaceFieldAction(form());expect(m.redirect).toHaveBeenCalledWith("error",expect.stringContaining("Refresh and try again"),"race-week",2,"preparation");expect(m.report).not.toHaveBeenCalled();});
 it("preserves the selected doubleheader race and stage on database readiness or audit failure",async()=>{m.rpc.mockResolvedValue({error:{code:"P0001",message:"Prior results are unpublished"}});await freezeRaceFieldAction(form());expect(m.report).toHaveBeenCalledWith(expect.objectContaining({actorProfileId:"admin",tab:"race-week",resultRaceId:2,raceWeekPhase:"preparation"}));expect(m.invalidate).not.toHaveBeenCalled();});
});

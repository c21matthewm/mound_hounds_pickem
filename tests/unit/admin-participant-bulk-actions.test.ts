import { beforeEach, describe, expect, it, vi } from "vitest";
import { bulkUpdateParticipantsAction } from "@/app/admin/participant-bulk-actions";
const A = "00000000-0000-4000-8000-000000000001";
const mocks=vi.hoisted(()=>({admin:vi.fn(),rpc:vi.fn(),revalidate:vi.fn(),invalidate:vi.fn(),report:vi.fn()}));
vi.mock("@/lib/admin",()=>({requireAdmin:mocks.admin}));
vi.mock("@/lib/scoring-cache",()=>({invalidateScoringCache:mocks.invalidate}));
vi.mock("next/cache",()=>({revalidatePath:mocks.revalidate}));
vi.mock("@/lib/app-error-reporter",()=>({reportAppError:mocks.report,errorReference:()=>""}));
const state={ok:false,message:""};
const form=(values:Record<string,string>={})=> {
  const data=new FormData();
  for(const [key,value] of Object.entries({operation:"register",participant_season_id:"42",confirm_bulk_update:"yes",participants:JSON.stringify([{profile_id:A,expected_is_active:true,expected_status:null}]),...values})) data.set(key,value);
  return data;
};
beforeEach(()=> {
  vi.resetAllMocks();
  mocks.admin.mockResolvedValue({user:{id:A},supabase:{rpc:mocks.rpc}});
  mocks.rpc.mockResolvedValue({error:null,data:{updated_count:1}});
  mocks.report.mockResolvedValue(null);
});
describe("participant batch actions",()=> {
  it("authenticates before validation or data access",async()=> {
    mocks.admin.mockRejectedValue(new Error("Admin required"));
    await expect(bulkUpdateParticipantsAction(state,form())).rejects.toThrow("Admin required");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("returns validation errors without a mutation",async()=> {
    expect((await bulkUpdateParticipantsAction(state,form({operation:"delete"}))).ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("dispatches one audited transaction with explicit season and stale-value guards",async()=> {
    expect(await bulkUpdateParticipantsAction(state,form())).toEqual({ok:true,message:"Season registration confirmed for 1 account."});
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("admin_bulk_update_participants",{p_operation:"register",p_season_id:42,p_participants:[{profile_id:A,expected_is_active:true,expected_status:null}]});
    expect(mocks.invalidate).toHaveBeenCalledOnce();
    expect(mocks.revalidate.mock.calls.map(([path])=>path)).toEqual(["/admin","/dashboard","/picks","/leaderboard","/season-registration"]);
    expect(mocks.report).not.toHaveBeenCalled();
  });
  it.each(["55P03","40P01","40001"])("returns useful retry guidance for %s",async code=> {
    mocks.rpc.mockResolvedValue({error:{code,message:"private database internals"}});
    const result=await bulkUpdateParticipantsAction(state,form());
    expect(result.ok).toBe(false); expect(result.message).toContain("Refresh Participants");
    expect(result.message).not.toContain("private database"); expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it.each(["PGRST202","42883"])("fails closed without migration %s",async code=> {
    mocks.rpc.mockResolvedValue({error:{code,message:"unavailable"}});
    expect((await bulkUpdateParticipantsAction(state,form())).message).toContain("migration");
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });
  it("refreshes affected views but does not claim success for an unconfirmed response",async()=> {
    mocks.rpc.mockResolvedValue({error:null,data:null});
    const result=await bulkUpdateParticipantsAction(state,form());
    expect(result.ok).toBe(false); expect(result.message).toContain("could not be confirmed");
    expect(mocks.invalidate).toHaveBeenCalledOnce();
  });
  it("keeps the form usable after a thrown transport error and reporter failure",async()=> {
    mocks.rpc.mockRejectedValue(new TypeError("fetch failed"));
    mocks.report.mockRejectedValue(new Error("reporter offline"));
    const result=await bulkUpdateParticipantsAction(state,form());
    expect(result.ok).toBe(false); expect(result.message).toContain("could not be confirmed");
    expect(result.message).toContain("before retrying");
    expect(mocks.invalidate).toHaveBeenCalledOnce();
    expect(mocks.revalidate).toHaveBeenCalledTimes(5);
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });
  it("treats a transport error returned as a response as an unconfirmed outcome",async()=> {
    mocks.rpc.mockResolvedValue({error:{code:"",message:"TypeError: fetch failed"},data:null});
    const result=await bulkUpdateParticipantsAction(state,form());
    expect(result.ok).toBe(false); expect(result.message).toContain("could not be confirmed");
    expect(mocks.invalidate).toHaveBeenCalledOnce(); expect(mocks.rpc).toHaveBeenCalledOnce();
  });
  it("preserves a specific database rejection even if reporting is unavailable",async()=> {
    mocks.rpc.mockResolvedValue({error:{code:"P0001",message:"A selected participant has submitted picks."}});
    mocks.report.mockRejectedValue(new Error("reporter offline"));
    const result=await bulkUpdateParticipantsAction(state,form());
    expect(result).toEqual({ok:false,message:"A selected participant has submitted picks."});
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });
  it("does not report success after a transaction rejection",async()=> {
    mocks.rpc.mockResolvedValue({error:{code:"P0001",message:"A selected participant has submitted picks."}});
    expect((await bulkUpdateParticipantsAction(state,form())).ok).toBe(false);
    expect(mocks.report).toHaveBeenCalledOnce(); expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});

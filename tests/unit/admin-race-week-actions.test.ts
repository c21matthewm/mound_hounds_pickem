import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(()=>({auth:vi.fn(),job:vi.fn(),audit:vi.fn(),invalidate:vi.fn(),revalidate:vi.fn(),redirect:vi.fn(),report:vi.fn()}));
vi.mock("@/lib/admin",()=>({requireAdmin:m.auth}));
vi.mock("@/lib/admin-audit",()=>({recordAdminAudit:m.audit}));
vi.mock("@/lib/fantasy-winner",()=>({finalizeDueRaceWinners:m.job}));
vi.mock("@/lib/job-runs",()=>({withJobRun:async (_name:string,run:()=>unknown)=>run()}));
vi.mock("@/lib/scoring-cache",()=>({invalidateScoringCache:m.invalidate}));
vi.mock("next/cache",()=>({revalidatePath:m.revalidate}));
vi.mock("@/app/admin/action-runtime",()=>({adminRedirect:m.redirect,reportAdminActionFailure:m.report}));
import {triggerFantasyWinnerJobAction} from "@/app/admin/race-week-actions";
beforeEach(()=>{vi.clearAllMocks();m.auth.mockResolvedValue({supabase:{},user:{id:"admin"}});m.job.mockResolvedValue({processedRaceCount:3,updatedRaceCount:2,failedRaceCount:1,failures:[]});});
describe("Manual winner job",()=>{
 it("authorizes before starting a privileged job",async()=>{m.auth.mockRejectedValue(new Error("Unauthorized"));await expect(triggerFantasyWinnerJobAction()).rejects.toThrow("Unauthorized");expect(m.job).not.toHaveBeenCalled();});
 it("records aggregate outcomes and refreshes scores even on partial failure",async()=>{await triggerFantasyWinnerJobAction();expect(m.audit).toHaveBeenCalledWith({},expect.objectContaining({action:"run_fantasy_winner_check",afterState:{processed:3,updated:2,failed:1}}));expect(m.invalidate).toHaveBeenCalledOnce();expect(m.redirect).toHaveBeenCalledWith("error",expect.stringContaining("1 failed"),"health");});
 it("refreshes scores after an exception because some races may already have completed",async()=>{m.job.mockRejectedValue(new Error("failure"));await triggerFantasyWinnerJobAction();expect(m.report).toHaveBeenCalled();expect(m.invalidate).toHaveBeenCalledOnce();expect(m.revalidate).toHaveBeenCalledWith("/leaderboard");expect(m.audit).not.toHaveBeenCalled();});
});

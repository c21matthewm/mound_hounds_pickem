import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDriverAction, deleteDriverAction, updateDriverAction } from "@/app/admin/driver-actions";
import { createRaceAction, deleteRaceAction, updateRaceAction } from "@/app/admin/race-actions";
import { isConfirmedMediaWriteRejection } from "@/lib/media-write-outcome";
const m=vi.hoisted(()=>({auth:vi.fn(),deleteDriver:vi.fn(),deleteRace:vi.fn(),uploadDriver:vi.fn(),uploadRace:vi.fn(),report:vi.fn(),audit:vi.fn(),redirect:vi.fn(),invalidate:vi.fn(),revalidate:vi.fn(),refresh:vi.fn(),writeError:null as {code?:string;message:string}|null,throwWrite:false}));
vi.mock("server-only",()=>({}));
vi.mock("next/cache",()=>({revalidatePath:m.revalidate}));
vi.mock("next/navigation",()=>({redirect:m.redirect}));
vi.mock("@/lib/admin",()=>({requireAdmin:m.auth}));
vi.mock("@/lib/admin-audit",()=>({recordAdminAudit:m.audit}));
vi.mock("@/lib/app-error-reporter",()=>({reportAppError:m.report,errorReference:()=>" [fixture reference]"}));
vi.mock("@/lib/fantasy-winner",()=>({finalizeRaceWinnerNow:vi.fn()}));
vi.mock("@/lib/scoring-cache",()=>({invalidateScoringCache:m.invalidate}));
vi.mock("@/lib/driver-images",()=>({deleteManagedDriverHeadshot:m.deleteDriver,uploadDriverHeadshot:m.uploadDriver,getFormFile:(form:FormData,key:string)=>{const value=form.get(key);return value instanceof File?value:null;}}));
vi.mock("@/lib/race-images",()=>({deleteManagedRaceTitleImage:m.deleteRace,uploadRaceTitleImage:m.uploadRace}));
vi.mock("@/app/admin/action-runtime",async importOriginal=>({...await importOriginal<typeof import("@/app/admin/action-runtime")>(),refreshDriverStandingsAndGroups:m.refresh}));
const oldUrl="https://storage.example.test/old-recovery-image.webp";
const newUrl="https://storage.example.test/new-request-image.webp";
const otherUrl="https://storage.example.test/another-existing-image.webp";
function form(entity:"driver"|"race",upload=true) {
 const f=new FormData();f.set("tab",entity==="driver"?"drivers":"races");f.set(`${entity}_id`,"11");f.set(`${entity}_name`,"Fixture event");
 if(entity==="driver") {f.set("is_active","on");f.set("image_url",otherUrl);}
 else {for(const [key,value] of Object.entries({season_id:"1",round_number:"1",payout:"0",pick_format:"standard",race_date:"2027-05-02T12:00",qualifying_start_at:"2027-05-01T12:00",title_image_url:otherUrl}))f.set(key,value);}
 if(upload)f.set(entity==="driver"?"image_file":"title_image_file",new File(["fixture"],"fixture.png",{type:"image/png"}));
 return f;
}
function client() {
 const from=vi.fn((table:string)=>{
  let mutation="read";let countOnly=false;
  const response=()=>{
   if((mutation==="update" || mutation==="delete") && m.throwWrite) throw new Error("The connection dropped after sending the write.");
   if(mutation!=="read" && mutation!=="insert" && m.writeError)return {data:null,error:m.writeError,count:null};
   if(mutation==="insert")return {data:{id:11},error:null};
   if(countOnly)return {count:table==="races"?1:0,data:null,error:null};
   if(table==="league_seasons")return {data:{id:1,season_year:2027,status:"active"},error:null};
   if(table==="drivers")return {data:{driver_name:"Fixture event",image_url:oldUrl,is_active:true},error:null};
   if(table==="races")return {data:{race_name:"Fixture event",title_image_url:oldUrl,season_id:1,round_number:1,pick_format:"standard",pick_window_key:"fixture-window",qualifying_start_at:"2027-05-01T16:00:00.000Z",race_date:"2027-05-02T16:00:00.000Z",field_frozen_at:null},error:null};
   return {data:[],error:null,count:0};
  };
  const q={select:(_columns:string,options?:{head?:boolean})=>{countOnly=Boolean(options?.head);return q;},eq:()=>q,or:()=>q,limit:()=>q,update:()=>{mutation="update";return q;},delete:()=>{mutation="delete";return q;},insert:()=>{mutation="insert";return q;},single:()=>Promise.resolve().then(response),maybeSingle:()=>Promise.resolve().then(response),then:(resolve:(r:unknown)=>unknown,reject:(e:unknown)=>unknown)=>Promise.resolve().then(response).then(resolve,reject)};
  return q;
 });
 return {from,rpc:vi.fn().mockResolvedValue({data:null,error:null})};
}
beforeEach(()=>{
 vi.clearAllMocks();m.writeError=null;m.throwWrite=false;m.auth.mockResolvedValue({supabase:client(),user:{id:"fixture-admin"}});m.uploadDriver.mockResolvedValue(newUrl);m.uploadRace.mockResolvedValue(newUrl);m.deleteDriver.mockResolvedValue(undefined);m.deleteRace.mockResolvedValue(undefined);m.report.mockResolvedValue({});m.redirect.mockImplementation(()=>{throw new Error("REDIRECT");});
});
describe("media write outcomes",()=>{
 it.each(["23505","23503","42501","P0001","40001","40P01","PGRST202","PGRST204"])("recognizes definite rejection %s",code=>{expect(isConfirmedMediaWriteRejection({code,message:"Fixture"})).toBe(true);});
 it.each([undefined,"","08P01","08006","40003","57P01","PGRST000","PGRST116","unknown"])("retains media for an unconfirmed outcome %s",code=>{expect(isConfirmedMediaWriteRejection({code,message:"Fixture"})).toBe(false);});
});
for(const [entity,create,update,remove,deleteUpload] of [["driver",createDriverAction,updateDriverAction,deleteDriverAction,m.deleteDriver],["race",createRaceAction,updateRaceAction,deleteRaceAction,m.deleteRace]] as const) {
 describe(`${entity} recovery media`,()=>{
  it("retains the previous object after successful replacement",async()=>{
   await expect(update(form(entity))).rejects.toThrow("REDIRECT");expect(deleteUpload).not.toHaveBeenCalled();expect(m.audit).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({action:"update"}));expect(m.redirect).toHaveBeenCalledWith(expect.stringContaining("message="));
  });
  it("retains the previous object after record deletion",async()=>{
   await expect(remove(form(entity,false))).rejects.toThrow("REDIRECT");expect(deleteUpload).not.toHaveBeenCalled();expect(m.audit).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({action:"delete"}));
  });
  it.each([false,true])("retains deleted-record media after an uncertain deletion (thrown transport error: %s)",async thrown=>{
   m.throwWrite=thrown;m.writeError={message:"Fetch failed"};await expect(remove(form(entity,false))).rejects.toThrow("REDIRECT");expect(deleteUpload).not.toHaveBeenCalled();expect(m.audit).not.toHaveBeenCalled();expect(m.report).toHaveBeenCalledWith(expect.objectContaining({code:"media-save-unconfirmed",context:expect.objectContaining({operation:"delete"})}));expect(m.revalidate).toHaveBeenCalledWith("/admin");
  });
  it("authorizes before uploading or deleting media",async()=>{
   m.auth.mockRejectedValue(new Error("Unauthorized"));await expect(update(form(entity))).rejects.toThrow("Unauthorized");expect(m.uploadDriver).not.toHaveBeenCalled();expect(m.uploadRace).not.toHaveBeenCalled();expect(deleteUpload).not.toHaveBeenCalled();
  });
  it("rolls back only this request’s new upload after a definite update rejection",async()=>{
   m.writeError={code:"P0001",message:"Fixture database rejection"};await expect(update(form(entity))).rejects.toThrow("REDIRECT");expect(deleteUpload).toHaveBeenCalledExactlyOnceWith(newUrl);expect(deleteUpload).not.toHaveBeenCalledWith(oldUrl);expect(m.audit).not.toHaveBeenCalled();
  });
  it("does not remove a URL supplied directly in the form after rejection",async()=>{
   m.writeError={code:"P0001",message:"Fixture database rejection"};await expect(update(form(entity,false))).rejects.toThrow("REDIRECT");expect(deleteUpload).not.toHaveBeenCalled();
  });
  it("retains a possibly committed upload and refreshes views after a lost response",async()=>{
   m.throwWrite=true;await expect(update(form(entity))).rejects.toThrow("REDIRECT");expect(deleteUpload).not.toHaveBeenCalled();expect(m.report).toHaveBeenCalledWith(expect.objectContaining({code:"media-save-unconfirmed"}));expect(m.revalidate).toHaveBeenCalledWith("/admin");expect(m.revalidate).toHaveBeenCalledWith("/picks");expect(m.invalidate).toHaveBeenCalled();expect(decodeURIComponent(m.redirect.mock.calls[0][0])).toContain("could+not+be+confirmed");expect(m.audit).not.toHaveBeenCalled();
  });
  it("does not catch the create-image failure redirect as a second upload failure",async()=>{
   m.writeError={code:"P0001",message:"Fixture database rejection"};await expect(create(form(entity))).rejects.toThrow("REDIRECT");expect(deleteUpload).toHaveBeenCalledExactlyOnceWith(newUrl);expect(m.report).toHaveBeenCalledTimes(1);expect(m.report).toHaveBeenCalledWith(expect.objectContaining({code:`save-${entity}-image-failed`}));
  });
  it("keeps the new image when a create-image save response is ambiguous",async()=>{
   m.writeError={message:"Fetch failed"};await expect(create(form(entity))).rejects.toThrow("REDIRECT");expect(deleteUpload).not.toHaveBeenCalled();expect(m.report).toHaveBeenCalledTimes(1);expect(m.report).toHaveBeenCalledWith(expect.objectContaining({code:"media-save-unconfirmed"}));
  });
  it("reports a failed orphan rollback while preserving the original rejection",async()=>{
   m.writeError={code:"P0001",message:"Fixture database rejection"};deleteUpload.mockRejectedValueOnce(new Error("Fixture cleanup failure"));await expect(update(form(entity))).rejects.toThrow("REDIRECT");expect(m.report).toHaveBeenCalledWith(expect.objectContaining({code:"rejected-image-cleanup-failed"}));expect(m.report).toHaveBeenCalledWith(expect.objectContaining({code:`update-${entity}-failed`}));expect(m.audit).not.toHaveBeenCalled();
  });
 });
}

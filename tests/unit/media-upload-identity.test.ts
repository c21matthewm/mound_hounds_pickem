import { beforeEach, describe, expect, it, vi } from "vitest";
import { uploadDriverHeadshot } from "@/lib/driver-images";
import { uploadRaceTitleImage } from "@/lib/race-images";
const m=vi.hoisted(()=>({upload:vi.fn(),optimize:vi.fn(),bucket:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("@/lib/supabase/managed-images",()=>({deleteManagedImage:vi.fn(),optimizeUploadedImage:m.optimize}));
vi.mock("@/lib/supabase/service-role",()=>({createServiceRoleSupabaseClient:()=>({storage:{getBucket:m.bucket,from:()=>({upload:m.upload,getPublicUrl:(path:string)=>({data:{publicUrl:`https://fixture.example/${path}`}})})}})}));
beforeEach(()=>{vi.clearAllMocks();m.bucket.mockResolvedValue({data:{public:true},error:null});m.upload.mockResolvedValue({data:{},error:null});m.optimize.mockResolvedValue(new Uint8Array([1,2,3]));});
describe("request-owned media uploads",()=>{
 it.each(["driver","race"] as const)("uses unique immutable %s object names even in the same millisecond",async kind=>{
  vi.spyOn(Date,"now").mockReturnValue(1800000000000);
  try {
   const file=new File(["fixture"],"fixture.png",{type:"image/png"});
   const upload=()=>kind==="driver"?uploadDriverHeadshot({driverId:11,driverName:"Fixture Name",file}):uploadRaceTitleImage({raceId:11,raceName:"Fixture Name",file});
   const urls=await Promise.all([upload(),upload()]);expect(urls[0]).not.toBe(urls[1]);
   for(const [path,bytes,options] of m.upload.mock.calls) {
    expect(path).toMatch(new RegExp(`^${kind}s/11/fixture-name-[0-9a-f-]{36}\\.webp$`));expect(bytes).toEqual(new Uint8Array([1,2,3]));expect(options).toEqual({cacheControl:"31536000",contentType:"image/webp",upsert:false});
   }
  } finally {vi.restoreAllMocks();}
 });
 it("does not return a URL after Storage rejects an upload",async()=>{
  m.upload.mockResolvedValue({error:{message:"Fixture collision"}});await expect(uploadDriverHeadshot({driverId:11,driverName:"Fixture",file:new File(["fixture"],"fixture.png",{type:"image/png"})})).rejects.toThrow("Failed to upload image");
 });
});

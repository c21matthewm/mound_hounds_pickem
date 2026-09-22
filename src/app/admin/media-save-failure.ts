import "server-only";
import { revalidatePath } from "next/cache";
import { errorReference, reportAppError } from "@/lib/app-error-reporter";
import { isConfirmedMediaWriteRejection, type MediaWriteError } from "@/lib/media-write-outcome";
import { adminMutationRedirect, type AdminTab } from "@/app/admin/action-runtime";

// Call after requireAdmin. uploadedUrl must come from this request's successful
// upload helper, never from a form field or an existing database record.
export async function handleMediaSaveFailure(options: {
  error: MediaWriteError;
  uploadedUrl: string | null;
  deleteUpload: (url: string | null) => Promise<void>;
  actorProfileId: string;
  entityType: "driver" | "race";
  entityId: number;
  operation: string;
  description: string;
  tab: AdminTab;
}): Promise<void> {
  const {error,uploadedUrl,deleteUpload,actorProfileId,entityType,entityId,operation,description,tab} = options;
  if (isConfirmedMediaWriteRejection(error)) {
    if (uploadedUrl) {
      try { await deleteUpload(uploadedUrl); }
      catch (cleanupError) {
        await reportAppError({actorProfileId,code:"rejected-image-cleanup-failed",context:{entityType,entityId,operation},error:cleanupError,route:`/admin?tab=${tab}`,subsystem:"storage",severity:"warning"});
      }
    }
    return;
  }
  // The write may have committed. Avoid deleting its file or presenting stale data
  // as proof of failure; the admin should inspect the record before repeating it.
  for (const path of ["/admin","/dashboard","/picks","/leaderboard","/race-center"]) revalidatePath(path);
  const reported = await reportAppError({actorProfileId,code:"media-save-unconfirmed",context:{entityType,entityId,operation},error,route:`/admin?tab=${tab}`,subsystem:"storage",severity:"warning"});
  adminMutationRedirect("error",`${description} could not be confirmed. Refresh and check the record before trying again.${uploadedUrl ? " The uploaded image was retained." : ""}${errorReference(reported)}`,tab);
}

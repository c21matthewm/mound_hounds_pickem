import { NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { verifyAdminRequestToken } from "@/lib/admin-request-token";
import { sanitizeTechnicalSummary } from "@/lib/app-error-safety";
import { SCORING_CACHE_TAG } from "@/lib/scoring-cache";
import { hasSameRequestOrigin } from "@/lib/request-origin";
import {
  SEASON_BACKUP_FORMAT,
  SEASON_BACKUP_FORMAT_VERSION,
  PORTABLE_SEASON_BACKUP_MIGRATION_FILE,
  seasonBackupFilename
} from "@/lib/season-recovery";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isJson } from "@/lib/supabase/json";
import {
  MANUAL_BACKUP_PROTECTION_KEY,
  RECOVERY_RETENTION_MIGRATION_FILE,
  isRestorePointId,
  isRetentionReviewToken,
  parseRecoveryRetention,
  parseRecoveryCleanupResult,
  parseRecoveryProtectionResult
} from "@/lib/recovery-retention";

export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 8 * 1024 * 1024;

type AdminContext =
  | {
      ok: true;
      supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
      userId: string;
    }
  | { ok: false; response: NextResponse };

const requireApiAdmin = async (): Promise<AdminContext> => {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: authError
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Sign in again before using season recovery." }, { status: 401 })
    };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle<{ role: string }>();

  if (profileError || profile?.role !== "admin") {
    return {
      ok: false,
      response: NextResponse.json({ error: "Admin access required." }, { status: 403 })
    };
  }

  return { ok: true, supabase, userId: user.id };
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Season recovery request failed.";

const isSameOriginRequest = (request: Request): boolean => {
  const fetchSite = request.headers.get("sec-fetch-site");
  return (
    hasSameRequestOrigin(request) &&
    (!fetchSite || fetchSite === "same-origin") &&
    request.headers.get("x-mound-hounds-request") === "season-recovery"
  );
};

const parseRequestBody = async (request: Request): Promise<Record<string, unknown>> => {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    throw new Error("Backup request is too large. Use a backup file smaller than 8 MB.");
  }

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_REQUEST_BYTES) {
    throw new Error("Backup request is too large. Use a backup file smaller than 8 MB.");
  }

  const parsed = JSON.parse(rawBody) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Season recovery request is invalid.");
  }

  return parsed as Record<string, unknown>;
};

const refreshRecoveredPages = (): void => {
  revalidateTag(SCORING_CACHE_TAG, { expire: 0 });
  revalidatePath("/admin");
  revalidatePath("/dashboard");
  revalidatePath("/picks");
  revalidatePath("/leaderboard");
};

export async function GET(request: Request) {
  const admin = await requireApiAdmin();
  if (!admin.ok) {
    return admin.response;
  }

  const restorePointId = new URL(request.url).searchParams.get("id");
  if (!restorePointId) {
    return NextResponse.json({ error: "Select a restore point to download." }, { status: 400 });
  }

  // The RPC casts the snapshot to text in PostgreSQL. Never parse/re-serialize
  // snapshotText in JavaScript: doing so changes fixed-scale numeric values.
  const { data, error } = await admin.supabase.rpc("export_season_restore_point", {
    p_restore_point_id: restorePointId
  });

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Restore point was not found." },
      { status: error && error.code !== "P0002" ? 500 : 404 }
    );
  }

  if (
    typeof data !== "object" || Array.isArray(data) ||
    data.format !== SEASON_BACKUP_FORMAT ||
    data.formatVersion !== SEASON_BACKUP_FORMAT_VERSION ||
    typeof data.snapshotText !== "string" ||
    typeof data.checksum !== "string" || !/^[0-9a-f]{64}$/i.test(data.checksum) ||
    typeof data.createdAt !== "string" || typeof data.label !== "string" ||
    typeof data.seasonYear !== "number" || !Number.isInteger(data.seasonYear)
  ) {
    return NextResponse.json(
      { error: `The backup export could not be verified. Apply ${PORTABLE_SEASON_BACKUP_MIGRATION_FILE} before downloading backups.` },
      { status: 500 }
    );
  }
  const filename = seasonBackupFilename({
    createdAt: data.createdAt,
    label: data.label,
    seasonYear: data.seasonYear
  });

  return new NextResponse(`${JSON.stringify(data, null, 2)}\n`, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Cross-origin recovery requests are not allowed." }, { status: 403 });
  }

  const admin = await requireApiAdmin();
  if (!admin.ok) {
    return admin.response;
  }

  try {
    const body = await parseRequestBody(request);
    const action = typeof body.action === "string" ? body.action : "";
    const requestToken = typeof body.requestToken === "string" ? body.requestToken : "";
    if (
      !verifyAdminRequestToken({
        purpose: "season-recovery",
        token: requestToken,
        userId: admin.userId
      })
    ) {
      return NextResponse.json(
        { error: "This recovery page expired. Refresh the page before continuing." },
        { status: 403 }
      );
    }

    if (action === "create") {
      const seasonId = Number(body.seasonId);
      if (!Number.isInteger(seasonId) || seasonId <= 0) {
        return NextResponse.json({ error: "Select a valid season." }, { status: 400 });
      }

      if (body.keepPermanently !== undefined && typeof body.keepPermanently !== "boolean") {
        return NextResponse.json({ error: "Choose whether to keep this backup permanently." }, { status: 400 });
      }
      const label =
        typeof body.label === "string" && body.label.trim()
          ? body.label.trim().slice(0, 160)
          : `Manual backup ${new Date().toISOString()}`;
      const { data, error } = await admin.supabase.rpc("create_season_restore_point_v2", {
        p_label: label,
        p_retention_key: body.keepPermanently === true ? MANUAL_BACKUP_PROTECTION_KEY : null,
        p_season_id: seasonId,
        p_source: "manual"
      });
      if (error) {
        throw new Error(error.message);
      }

      revalidatePath("/admin");
      return NextResponse.json({ data });
    }

    if (action === "retention-preview" || action === "cleanup") {
      const seasonId = Number(body.seasonId);
      if (!Number.isSafeInteger(seasonId) || seasonId <= 0) {
        return NextResponse.json({ error: "Select a valid backup season." }, { status: 400 });
      }
      if (action === "retention-preview") {
        const { data, error } = await admin.supabase.rpc("get_season_restore_point_retention", { p_season_id: seasonId });
        if (error) throw new Error(error.code === "PGRST202"
          ? `Apply ${RECOVERY_RETENTION_MIGRATION_FILE} to enable retention controls.` : error.message);
        const retention = parseRecoveryRetention(data);
        if (!retention || retention.seasonId !== seasonId) throw new Error("The cleanup preview could not be verified. Refresh Recovery before continuing.");
        return NextResponse.json({ data: retention });
      }
      if (!isRetentionReviewToken(body.reviewToken)) {
        return NextResponse.json({ error: "Review the older backups before removing them." }, { status: 400 });
      }
      const { data, error } = await admin.supabase.rpc("cleanup_season_restore_points", {
        p_season_id: seasonId, p_review_token: body.reviewToken
      });
      if (error) throw new Error(error.code === "PGRST202"
        ? `Apply ${RECOVERY_RETENTION_MIGRATION_FILE} to enable retention controls.` : error.message);
      const result = parseRecoveryCleanupResult(data);
      if (!result || result.retention.seasonId !== seasonId) {
        throw new Error("The cleanup response could not be verified. Refresh Recovery and check the retained backups before trying again.");
      }
      try { revalidatePath("/admin"); } catch {
        return NextResponse.json({ data: result, warning: "Backup cleanup completed, but the list could not refresh. Reload Recovery before another cleanup." });
      }
      return NextResponse.json({ data: result });
    }

    if (action === "protect") {
      if (!isRestorePointId(body.restorePointId) || typeof body.protected !== "boolean") {
        return NextResponse.json({ error: "Select a manual backup and its retention option." }, { status: 400 });
      }
      const { data, error } = await admin.supabase.rpc("set_season_restore_point_protection", {
        p_restore_point_id: body.restorePointId, p_protected: body.protected
      });
      if (error) throw new Error(error.code === "PGRST202"
        ? `Apply ${RECOVERY_RETENTION_MIGRATION_FILE} to enable retention controls.` : error.message);
      const result = parseRecoveryProtectionResult(data);
      if (!result || result.id !== body.restorePointId || result.protected !== body.protected) {
        throw new Error("The retention response could not be verified. Refresh Recovery and check this backup before trying again.");
      }
      try { revalidatePath("/admin"); } catch {
        return NextResponse.json({ data: result, warning: "The backup retention option was saved, but the list could not refresh. Reload Recovery before continuing." });
      }
      return NextResponse.json({ data: result });
    }

    if (action === "import") {
      if (
        !body.document ||
        typeof body.document !== "object" ||
        Array.isArray(body.document) ||
        !isJson(body.document)
      ) {
        return NextResponse.json({ error: "Choose a valid Mound Hounds backup file." }, { status: 400 });
      }

      const { data, error } = await admin.supabase.rpc("import_season_restore_point_v2", {
        p_document: body.document
      });
      if (error) {
        throw new Error(error.message);
      }

      revalidatePath("/admin");
      return NextResponse.json({ data });
    }

    if (action === "preview") {
      const restorePointId =
        typeof body.restorePointId === "string" ? body.restorePointId : "";
      if (!restorePointId) {
        return NextResponse.json({ error: "Select a restore point to preview." }, { status: 400 });
      }

      const { data, error } = await admin.supabase.rpc("preview_season_restore_point", {
        p_restore_point_id: restorePointId
      });
      if (error) {
        throw new Error(error.message);
      }

      return NextResponse.json({ data });
    }

    if (action === "restore") {
      const restorePointId =
        typeof body.restorePointId === "string" ? body.restorePointId : "";
      const confirmationYear = Number(body.confirmationYear);
      if (!restorePointId || !Number.isInteger(confirmationYear)) {
        return NextResponse.json(
          { error: "Select a restore point and enter the confirmation year." },
          { status: 400 }
        );
      }

      const { data, error } = await admin.supabase.rpc("restore_season_from_restore_point_v2", {
        p_confirmation_year: confirmationYear,
        p_restore_point_id: restorePointId
      });
      if (error) {
        throw new Error(error.message);
      }

      try {
        refreshRecoveredPages();
      } catch (refreshError) {
        // The restore RPC has committed. A cache failure must not suggest retrying it.
        console.error(
          "[season-recovery] Restore committed, but cache refresh failed:",
          sanitizeTechnicalSummary(refreshError)
        );
        return NextResponse.json({
          data,
          warning:
            "Season data was restored, but cached pages could not be refreshed. Some views may temporarily show old data. Do not repeat the restore."
        });
      }
      return NextResponse.json({ data });
    }

    return NextResponse.json({ error: "Unknown season recovery action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
  }
}

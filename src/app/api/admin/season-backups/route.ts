import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { verifyAdminRequestToken } from "@/lib/admin-request-token";
import { invalidateScoringCache } from "@/lib/scoring-cache";
import { canonicalSiteOrigin } from "@/lib/site-url";
import {
  SEASON_BACKUP_FORMAT,
  SEASON_BACKUP_FORMAT_VERSION,
  seasonBackupFilename,
  type SeasonRestorePointSummary
} from "@/lib/season-recovery";
import { createServerSupabaseClient } from "@/lib/supabase/server";

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
  const origin = request.headers.get("origin");
  if (!origin) {
    return false;
  }

  try {
    const expectedOrigin =
      process.env.NODE_ENV === "production"
        ? canonicalSiteOrigin()
        : new URL(request.url).origin;
    const fetchSite = request.headers.get("sec-fetch-site");
    return (
      new URL(origin).origin === expectedOrigin &&
      (!fetchSite || fetchSite === "same-origin") &&
      request.headers.get("x-mound-hounds-request") === "season-recovery"
    );
  } catch {
    return false;
  }
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
  invalidateScoringCache();
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

  const { data, error } = await admin.supabase
    .from("season_restore_points")
    .select(
      "id,season_id,season_year,label,source,schema_version,format_version,row_counts,checksum,created_at,snapshot"
    )
    .eq("id", restorePointId)
    .maybeSingle<
      SeasonRestorePointSummary & {
        snapshot: Record<string, unknown>;
      }
    >();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Restore point was not found." },
      { status: error ? 500 : 404 }
    );
  }

  const document = {
    backupId: data.id,
    checksum: data.checksum,
    createdAt: data.created_at,
    format: SEASON_BACKUP_FORMAT,
    formatVersion: SEASON_BACKUP_FORMAT_VERSION,
    label: data.label,
    rowCounts: data.row_counts,
    schemaVersion: data.schema_version,
    seasonYear: data.season_year,
    snapshot: data.snapshot,
    source: data.source
  };
  const filename = seasonBackupFilename({
    createdAt: data.created_at,
    label: data.label,
    seasonYear: data.season_year
  });

  return new NextResponse(`${JSON.stringify(document, null, 2)}\n`, {
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

      const label =
        typeof body.label === "string" && body.label.trim()
          ? body.label.trim().slice(0, 160)
          : `Manual backup ${new Date().toISOString()}`;
      const { data, error } = await admin.supabase.rpc("create_season_restore_point_v2", {
        p_label: label,
        p_retention_key: null,
        p_season_id: seasonId,
        p_source: "manual"
      });
      if (error) {
        throw new Error(error.message);
      }

      revalidatePath("/admin");
      return NextResponse.json({ data });
    }

    if (action === "import") {
      if (!body.document || typeof body.document !== "object" || Array.isArray(body.document)) {
        return NextResponse.json({ error: "Choose a valid Mound Hounds backup file." }, { status: 400 });
      }

      const { data, error } = await admin.supabase.rpc("import_season_restore_point", {
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

      refreshRecoveredPages();
      return NextResponse.json({ data });
    }

    return NextResponse.json({ error: "Unknown season recovery action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
  }
}

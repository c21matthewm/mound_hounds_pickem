import "server-only";

import sharp from "sharp";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service-role";

type OptimizeOptions = {
  height: number;
  quality: number;
  width: number;
};

export async function optimizeUploadedImage(
  file: File,
  options: OptimizeOptions
): Promise<Uint8Array<ArrayBuffer>> {
  try {
    const source = Buffer.from(await file.arrayBuffer());
    const { data } = await sharp(source, { failOn: "error" })
      .rotate()
      .resize({
        fit: "inside",
        height: options.height,
        width: options.width,
        withoutEnlargement: true
      })
      .webp({ effort: 4, quality: options.quality })
      .toUint8Array();

    // Supabase's fetch path rejects SharedArrayBuffer-backed views in some server runtimes.
    return Uint8Array.from(data);
  } catch {
    throw new Error("The uploaded image could not be processed. Use a valid JPG, PNG, WebP, GIF, or AVIF file.");
  }
}

const managedObjectPath = (bucket: string, publicUrl: string): string | null => {
  if (!publicUrl) {
    return null;
  }

  try {
    const candidate = new URL(publicUrl);
    const supabaseUrl = new URL(getSupabaseEnv().url);
    if (candidate.host !== supabaseUrl.host) {
      return null;
    }

    const marker = `/storage/v1/object/public/${bucket}/`;
    const markerIndex = candidate.pathname.indexOf(marker);
    if (markerIndex < 0) {
      return null;
    }

    const encodedPath = candidate.pathname.slice(markerIndex + marker.length);
    return encodedPath ? decodeURIComponent(encodedPath) : null;
  } catch {
    return null;
  }
};

export async function deleteManagedImage(bucket: string, publicUrl: string | null): Promise<void> {
  if (!publicUrl) {
    return;
  }

  const path = managedObjectPath(bucket, publicUrl);
  if (!path) {
    return;
  }

  const service = createServiceRoleSupabaseClient();
  const { error } = await service.storage.from(bucket).remove([path]);
  if (error && error.status !== 404) {
    throw new Error(`Failed to remove replaced image: ${error.message}`);
  }
}

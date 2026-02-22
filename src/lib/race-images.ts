import "server-only";

import { createServiceRoleSupabaseClient } from "@/lib/supabase/service-role";

const RACE_IMAGE_BUCKET = "race-title-images";
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp"
]);

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

const extensionFromFile = (file: File): string => {
  const filenamePart = file.name?.split(".").pop()?.toLowerCase();
  if (filenamePart && filenamePart.length <= 5) {
    return filenamePart;
  }

  switch (file.type) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/avif":
      return "avif";
    default:
      return "jpg";
  }
};

const isBucketMissingError = (error: { message?: string; status?: number | undefined }): boolean =>
  error.status === 404 || /not found/i.test(error.message ?? "");

async function ensureRaceBucket() {
  const service = createServiceRoleSupabaseClient();
  const { data, error } = await service.storage.getBucket(RACE_IMAGE_BUCKET);

  if (error) {
    if (!isBucketMissingError(error)) {
      throw new Error(`Failed to check race image bucket: ${error.message}`);
    }

    const { error: createError } = await service.storage.createBucket(RACE_IMAGE_BUCKET, {
      allowedMimeTypes: [...ALLOWED_MIME_TYPES],
      fileSizeLimit: MAX_FILE_BYTES,
      public: true
    });

    if (createError && createError.status !== 409) {
      throw new Error(`Failed to create race image bucket: ${createError.message}`);
    }

    return;
  }

  if (!data.public) {
    const { error: updateError } = await service.storage.updateBucket(RACE_IMAGE_BUCKET, {
      allowedMimeTypes: [...ALLOWED_MIME_TYPES],
      fileSizeLimit: MAX_FILE_BYTES,
      public: true
    });

    if (updateError) {
      throw new Error(`Failed to update race image bucket visibility: ${updateError.message}`);
    }
  }
}

export async function uploadRaceTitleImage(params: {
  raceId: number;
  raceName: string;
  file: File;
}): Promise<string> {
  const { raceId, raceName, file } = params;

  if (file.size <= 0) {
    throw new Error("Uploaded file is empty.");
  }

  if (file.size > MAX_FILE_BYTES) {
    throw new Error("Image file is too large. Max size is 8MB.");
  }

  if (!file.type || !ALLOWED_MIME_TYPES.has(file.type)) {
    throw new Error("Unsupported image type. Use png, jpg, webp, gif, or avif.");
  }

  await ensureRaceBucket();
  const service = createServiceRoleSupabaseClient();

  const extension = extensionFromFile(file);
  const safeName = slugify(raceName) || `race-${raceId}`;
  const path = `races/${raceId}/${safeName}-${Date.now()}.${extension}`;

  const { error: uploadError } = await service.storage.from(RACE_IMAGE_BUCKET).upload(path, file, {
    cacheControl: "3600",
    contentType: file.type,
    upsert: true
  });

  if (uploadError) {
    throw new Error(`Failed to upload image: ${uploadError.message}`);
  }

  const { data } = service.storage.from(RACE_IMAGE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

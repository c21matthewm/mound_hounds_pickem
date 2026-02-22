import "server-only";

import { createServiceRoleSupabaseClient } from "@/lib/supabase/service-role";

const DRIVER_IMAGE_BUCKET = "driver-headshots";
const MAX_FILE_BYTES = 5 * 1024 * 1024;
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

async function ensureDriverBucket() {
  const service = createServiceRoleSupabaseClient();
  const { data, error } = await service.storage.getBucket(DRIVER_IMAGE_BUCKET);

  if (error) {
    if (!isBucketMissingError(error)) {
      throw new Error(`Failed to check storage bucket: ${error.message}`);
    }

    const { error: createError } = await service.storage.createBucket(DRIVER_IMAGE_BUCKET, {
      allowedMimeTypes: [...ALLOWED_MIME_TYPES],
      fileSizeLimit: MAX_FILE_BYTES,
      public: true
    });

    if (createError && createError.status !== 409) {
      throw new Error(`Failed to create storage bucket: ${createError.message}`);
    }

    return;
  }

  if (!data.public) {
    const { error: updateError } = await service.storage.updateBucket(DRIVER_IMAGE_BUCKET, {
      allowedMimeTypes: [...ALLOWED_MIME_TYPES],
      fileSizeLimit: MAX_FILE_BYTES,
      public: true
    });

    if (updateError) {
      throw new Error(`Failed to update storage bucket visibility: ${updateError.message}`);
    }
  }
}

export async function uploadDriverHeadshot(params: {
  driverId: number;
  driverName: string;
  file: File;
}): Promise<string> {
  const { driverId, driverName, file } = params;

  if (file.size <= 0) {
    throw new Error("Uploaded file is empty.");
  }

  if (file.size > MAX_FILE_BYTES) {
    throw new Error("Image file is too large. Max size is 5MB.");
  }

  if (!file.type || !ALLOWED_MIME_TYPES.has(file.type)) {
    throw new Error("Unsupported image type. Use png, jpg, webp, gif, or avif.");
  }

  await ensureDriverBucket();
  const service = createServiceRoleSupabaseClient();

  const extension = extensionFromFile(file);
  const safeName = slugify(driverName) || `driver-${driverId}`;
  const path = `drivers/${driverId}/${safeName}-${Date.now()}.${extension}`;

  const { error: uploadError } = await service.storage.from(DRIVER_IMAGE_BUCKET).upload(path, file, {
    cacheControl: "3600",
    contentType: file.type,
    upsert: true
  });

  if (uploadError) {
    throw new Error(`Failed to upload image: ${uploadError.message}`);
  }

  const { data } = service.storage.from(DRIVER_IMAGE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export function getFormFile(formData: FormData, key: string): File | null {
  const candidate = formData.get(key);
  if (!(candidate instanceof File)) {
    return null;
  }

  if (candidate.size <= 0) {
    return null;
  }

  return candidate;
}

import type { Json } from "@/lib/supabase/database.types";

export const isJson = (value: unknown): value is Json => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every(isJson);
  }

  if (typeof value !== "object") {
    return false;
  }

  return Object.values(value).every((entry) => entry === undefined || isJson(entry));
};

export const serializeJson = (value: unknown): Json => {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    return null;
  }

  return JSON.parse(serialized) as Json;
};

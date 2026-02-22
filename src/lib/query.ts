export function queryStringParam(
  value: string | string[] | undefined
): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value) && value.length > 0) {
    return value[0];
  }

  return undefined;
}

export function sanitizeNextPath(value: string | undefined): string {
  if (!value) {
    return "/onboarding";
  }

  if (!value.startsWith("/")) {
    return "/onboarding";
  }

  if (value.startsWith("//")) {
    return "/onboarding";
  }

  return value;
}

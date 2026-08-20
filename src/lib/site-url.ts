const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

const parseHttpOrigin = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
};

export const canonicalSiteOrigin = (
  configuredUrl = process.env.NEXT_PUBLIC_SITE_URL
): string => {
  const configuredOrigin = parseHttpOrigin(configuredUrl);
  if (configuredOrigin) {
    return configuredOrigin;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("NEXT_PUBLIC_SITE_URL must be a valid HTTP(S) URL in production.");
  }

  return "http://localhost:3000";
};

export const resolveAuthOrigin = ({
  configuredUrl = process.env.NEXT_PUBLIC_SITE_URL,
  nodeEnv = process.env.NODE_ENV,
  requestOrigin
}: {
  configuredUrl?: string;
  nodeEnv?: string;
  requestOrigin?: string | null;
}): string => {
  if (nodeEnv !== "production") {
    const localOrigin = parseHttpOrigin(requestOrigin);
    if (localOrigin && LOCAL_HOSTS.has(new URL(localOrigin).hostname)) {
      return localOrigin;
    }
  }

  const configuredOrigin = parseHttpOrigin(configuredUrl);
  if (configuredOrigin) {
    return configuredOrigin;
  }

  if (nodeEnv === "production") {
    throw new Error("NEXT_PUBLIC_SITE_URL must be configured before sending authentication email.");
  }

  return "http://localhost:3000";
};

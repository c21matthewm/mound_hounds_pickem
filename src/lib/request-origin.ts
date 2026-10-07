import { canonicalSiteOrigin } from "@/lib/site-url";

/** Match the browser's origin without trusting proxy origin headers. */
export const hasSameRequestOrigin = (request: Request): boolean => {
  const origin = request.headers.get("origin");
  if (!origin) return false;

  try {
    const browserOrigin = new URL(origin);
    if (
      !["http:", "https:"].includes(browserOrigin.protocol) ||
      browserOrigin.origin !== origin
    ) {
      return false;
    }

    if (process.env.NODE_ENV === "production") {
      return origin === canonicalSiteOrigin();
    }

    const requestUrl = new URL(request.url);
    if (!["http:", "https:"].includes(requestUrl.protocol)) return false;

    // Next dev can use its bind address (0.0.0.0) in Request.url. Host still
    // identifies the address the browser used, including its port on the LAN.
    const host = request.headers.get("host");
    if (host === null) return origin === requestUrl.origin;
    if (!host || /[\s\\/@?#]/u.test(host)) return false;

    const publicUrl = new URL(`${requestUrl.protocol}//${host}`);
    return origin === publicUrl.origin;
  } catch {
    return false;
  }
};

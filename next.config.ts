import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  experimental: {
    serverActions: {
      // Allow file uploads in Server Actions (race/driver images).
      bodySizeLimit: "12mb"
    }
  },
  async headers() {
    const headers = [
      { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
      { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=()" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "SAMEORIGIN" }
    ];

    if (process.env.NODE_ENV === "production") {
      headers.push({
        key: "Strict-Transport-Security",
        value: "max-age=31536000; includeSubDomains"
      });
    }

    return [{ headers, source: "/(.*)" }];
  }
};

export default nextConfig;

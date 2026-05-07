import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  experimental: {
    serverActions: {
      // Allow file uploads in Server Actions (race/driver images).
      bodySizeLimit: "12mb"
    }
  }
};

export default nextConfig;

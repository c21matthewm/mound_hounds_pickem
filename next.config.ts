import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Allow file uploads in Server Actions (race/driver images).
      bodySizeLimit: "12mb"
    }
  }
};

export default nextConfig;

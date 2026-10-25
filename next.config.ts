import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "@prisma/adapter-better-sqlite3"],
  experimental: {
    serverActions: {
      // Batches of reference files, change packages and backups exceed the 1 MB default.
      bodySizeLimit: "50mb",
    },
  },
};

export default nextConfig;

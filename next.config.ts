import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image deployed to Fly.io
  output: "standalone",
};

export default nextConfig;

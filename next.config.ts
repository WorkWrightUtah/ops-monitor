import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // Pin the workspace root to this repo. Without it Turbopack walks up the
    // tree looking for a lockfile and can latch onto an unrelated one in a
    // parent directory, which changes how modules resolve.
    root: __dirname,
  },
};

export default nextConfig;

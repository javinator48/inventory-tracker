import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets a demo build (DEMO_MODE=1) live beside the normal one without overwriting it.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;

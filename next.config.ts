import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep fixture-endpoint test builds separate from the deployment build.
  distDir: process.env.CARL_GUI_TEST_BUILD === "1" ? ".next-test" : ".next",
  images: {
    unoptimized: true,
  },
};

export default nextConfig;

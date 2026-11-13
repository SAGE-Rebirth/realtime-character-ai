import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@metaavatar/avatar-runtime", "@metaavatar/protocol"],
  reactStrictMode: true,
  // Keep the dev badge clear of the navigation rail's Settings link.
  devIndicators: { position: "bottom-right" },
};
export default config;

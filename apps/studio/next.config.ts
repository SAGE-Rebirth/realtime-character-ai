import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@metaavatar/avatar-runtime", "@metaavatar/protocol"],
  reactStrictMode: true,
};
export default config;

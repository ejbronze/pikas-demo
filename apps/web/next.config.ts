import type { NextConfig } from "next";
const config: NextConfig = { transpilePackages: ["@pikas/ui", "@pikas/data-access", "@pikas/shared-types"] };
export default config;

import type { NextConfig } from "next";

const configuredBasePath = process.env.NEXT_PUBLIC_BASE_PATH?.trim().replace(/\/+$/, "");

const nextConfig: NextConfig = configuredBasePath
  ? { basePath: configuredBasePath.startsWith("/") ? configuredBasePath : `/${configuredBasePath}` }
  : {};

export default nextConfig;

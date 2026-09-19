import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Top-level as of Next 16; it warned on every build while it sat under
  // `experimental`, which is noise in a CI log people are supposed to read.
  typedRoutes: true,
};

export default nextConfig;

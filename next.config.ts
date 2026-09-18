import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The analysis dataset is static once built; nothing here is user-specific,
  // so responses can be cached aggressively at the edge.
  experimental: { typedRoutes: true },
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Enable partial prerendering for hybrid static/dynamic pages
    ppr: true,
  },
  // Allow images from GitHub avatars
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
      { protocol: "https", hostname: "github.com" },
    ],
  },
};

export default nextConfig;

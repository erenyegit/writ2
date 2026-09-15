/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  async rewrites() {
    return {
      // COMING_SOON=true serves the splash at / while every other route stays
      // reachable. beforeFiles is required: / is a real page and would win otherwise.
      beforeFiles:
        process.env.COMING_SOON === "true" ? [{ source: "/", destination: "/coming-soon" }] : [],
    };
  },
};

export default nextConfig;

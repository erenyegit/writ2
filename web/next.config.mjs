/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  async redirects() {
    // The site lives at www.writ.fi. On production builds, any *.vercel.app
    // address of this project (writ2.vercel.app and the per-deployment URLs)
    // forwards there, so there is no second copy of the site to stumble on.
    // Preview builds keep their own URLs for testing.
    if (process.env.VERCEL_ENV !== "production") return [];
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: ".+\\.vercel\\.app" }],
        destination: "https://www.writ.fi/:path*",
        permanent: true,
      },
    ];
  },
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

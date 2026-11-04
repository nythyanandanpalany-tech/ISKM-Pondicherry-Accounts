import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Deployed on Vercel. Screens still talk to Supabase straight from the browser (row level
  // security guards the data); the only server-side route is the daily keep-alive ping, which is
  // why this is not a static export.
  images: { unoptimized: true },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

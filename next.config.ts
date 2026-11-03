import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export", // static site for Firebase Hosting (everything talks to Firebase from the browser)
  images: { unoptimized: true },
  /* config options here */
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

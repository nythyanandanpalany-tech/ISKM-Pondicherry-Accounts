import type { MetadataRoute } from "next";
import { brand } from "@/lib/brand";

/* Generated rather than kept as a static file in public/, so the temple's name
   lives only in lib/brand.ts. force-static is required: with output: "export"
   a manifest route is otherwise treated as dynamic and fails the build. */
export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${brand.name} · ${brand.app}`,
    short_name: brand.app,
    description: `Temple seva expenses, donations and bank reconciliation for ${brand.legalName} — a bill and a payment proof behind every entry.`,
    start_url: "/app",
    display: "standalone",
    background_color: "#fbf6ee",
    theme_color: "#b85410",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}

import type { Metadata } from "next";
import { Inter, Martel, Tiro_Devanagari_Sanskrit } from "next/font/google";
import "./globals.css";
import ThemeBoot from "@/components/Theme";
import { brand } from "@/lib/brand";

/* Inter carries the interface and every figure (tabular numerals matter in a ledger);
   Martel — drawn for Devanagari and Latin together — carries headings and the wordmark;
   Tiro Devanagari Sanskrit sets the verses. */
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const martel = Martel({ variable: "--font-martel", subsets: ["latin", "devanagari"], weight: ["400", "700", "800"] });
const tiro = Tiro_Devanagari_Sanskrit({ variable: "--font-tiro", subsets: ["devanagari", "latin"], weight: "400" });

export const viewport = { themeColor: "#b85410" };
export const metadata: Metadata = {
  manifest: "/manifest.webmanifest",
  title: { default: `${brand.name} · ${brand.app}`, template: `%s · ${brand.name}` },
  description: `${brand.app} for ${brand.legalName} — seva expenses, donations and bank reconciliation, with a bill and payment proof behind every entry.`,
  icons: { icon: [{ url: "/lotus.svg", type: "image/svg+xml" }, { url: "/icon-192.png", sizes: "192x192" }], apple: "/icon-192.png" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${martel.variable} ${tiro.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col"><ThemeBoot />{children}</body>
    </html>
  );
}

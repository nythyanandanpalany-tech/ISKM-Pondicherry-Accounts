import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import ThemeBoot from "@/components/Theme";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport = { themeColor: "#4f46e5" };
export const metadata: Metadata = {
  manifest: "/manifest.webmanifest",
  title: "ExpenseFlow",
  description: "Expense tracking with payment-to-bill matching",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col"><ThemeBoot />{children}</body>
    </html>
  );
}

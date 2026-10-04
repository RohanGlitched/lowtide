import type { Metadata, Viewport } from "next";
import { Barlow_Semi_Condensed, Newsreader } from "next/font/google";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import "./globals.css";

const barlow = Barlow_Semi_Condensed({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-barlow",
  display: "swap",
});
const newsreader = Newsreader({
  subsets: ["latin"],
  style: ["italic"],
  weight: ["400"],
  variable: "--font-newsreader",
  display: "swap",
});

const SITE = process.env.NEXT_PUBLIC_SITE_URL || "https://lowtide-energy.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: "Lowtide: run it at low tide", template: "%s · Lowtide" },
  description:
    "Ask Alexa when to run the dishwasher. Lowtide reads tonight's half-hourly electricity prices and the grid's carbon forecast, and picks the cheapest, cleanest time. An MCP server for Alexa+.",
  openGraph: { type: "website", siteName: "Lowtide" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f7f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1822" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${barlow.variable} ${newsreader.variable}`}>
      <body>
        <Header />
        {children}
        <Footer />
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Newsreader } from "next/font/google";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { SITE_URL } from "@/lib/site";
import "./globals.css";

// Self-hosted at build time by next/font: no request to Google from a visitor's browser.
const serif = Newsreader({ subsets: ["latin"], style: ["normal", "italic"], weight: ["400", "500"], variable: "--font-serif", display: "swap" });
const sans = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-sans", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["500", "700"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Lowtide: run it at low tide, with Alexa", template: "%s · Lowtide" },
  description:
    "Ask Alexa when to run the dishwasher. Lowtide reads every half-hourly electricity price and the grid's carbon forecast and picks the cheapest, cleanest time. An MCP server for Alexa+.",
  openGraph: { type: "website", siteName: "Lowtide", images: [{ url: "/og.png", width: 1000, height: 620, alt: "Lowtide: tonight's electricity prices as a moonlit tide" }] },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
};

export const viewport: Viewport = { themeColor: "#05070e" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        <Header />
        {children}
        <Footer />
      </body>
    </html>
  );
}

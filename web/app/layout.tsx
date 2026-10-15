import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { SITE_URL } from "@/lib/site";
import "./globals.css";

// Funnel Display and Funnel Sans (SIL OFL 1.1, see app/fonts/OFL.txt), self-hosted as the
// latin variable subsets so the build never depends on fetching Google Fonts.
const display = localFont({
  src: "./fonts/FunnelDisplay-latin.woff2",
  weight: "400 600",
  variable: "--font-display",
  display: "swap",
});
const text = localFont({
  src: "./fonts/FunnelSans-latin.woff2",
  weight: "400 700",
  variable: "--font-text",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Lowtide: the cheapest hour of the night, for Alexa", template: "%s · Lowtide" },
  description:
    "Ask Alexa when to run the dishwasher. Lowtide reads every half-hourly electricity price and the grid's carbon forecast and picks the cheapest, cleanest time. An MCP server for Alexa+.",
  openGraph: { type: "website", siteName: "Lowtide", images: [{ url: "/og.png", width: 1000, height: 620, alt: "Lowtide: the day's electricity prices as a machined ring of 48 fins" }] },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
};

export const viewport: Viewport = { themeColor: "#e9ebee" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${text.variable}`}>
      <body>
        <Header />
        {children}
        <Footer />
      </body>
    </html>
  );
}

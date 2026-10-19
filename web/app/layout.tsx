import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { SITE_URL } from "@/lib/site";
import "./globals.css";

// The fonts' Latin variable files live in app/fonts (SIL Open Font License): the build never
// fetches from Google, and neither does a visitor's browser.
const Newsreader = localFont({
  src: [
    { path: "./fonts/Newsreader.woff2", weight: "200 800", style: "normal" },
    { path: "./fonts/Newsreader-Italic.woff2", weight: "200 800", style: "italic" },
  ],
  variable: "--font-serif",
  display: "swap",
  adjustFontFallback: "Times New Roman",
});
const Inter = localFont({ src: "./fonts/Inter.woff2", weight: "100 900", variable: "--font-sans", display: "swap" });
const JetBrainsMono = localFont({ src: "./fonts/JetBrainsMono.woff2", weight: "100 800", variable: "--font-mono", display: "swap", adjustFontFallback: false });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Lowtide: run it at low tide, with Alexa", template: "%s · Lowtide" },
  description:
    "Ask Alexa when to run the dishwasher. Lowtide reads every half-hourly electricity price and the grid's carbon forecast and picks the cheapest, cleanest time. An MCP server for Alexa+.",
  openGraph: { type: "website", siteName: "Lowtide", images: [{ url: "/og.png", width: 1200, height: 630, alt: "Lowtide: power is cheapest at low tide. Ask Alexa when to run it." }] },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
};

export const viewport: Viewport = { themeColor: "#05070e" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${Newsreader.variable} ${Inter.variable} ${JetBrainsMono.variable}`}>
      <body>
        <a className="skip" href="#main">
          Skip to content
        </a>
        <Header />
        {children}
        <Footer />
      </body>
    </html>
  );
}

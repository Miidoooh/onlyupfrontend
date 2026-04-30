import type { Metadata, Viewport } from "next";
import { Inter, Bungee, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import dynamic from "next/dynamic";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const AppKitProviders = dynamic(
  () => import("../components/AppKitProviders").then((mod) => mod.AppKitProviders),
  { ssr: false }
);

const body = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-body"
});

const display = Space_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display"
});

const brand = Bungee({
  subsets: ["latin"],
  weight: "400",
  display: "swap",
  variable: "--font-brand"
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono"
});

export const metadata: Metadata = {
  title: "ONLY UP — the chart only knows one direction",
  description:
    "Every dump pays the next buyer. v4 hook skims a bounty, apes split the bag. Number go up by design.",
  keywords: ["Only Up", "UP", "Uniswap v4", "hook", "memecoin", "degen", "bounty"],
  openGraph: {
    title: "ONLY UP",
    description: "Dumps fund the bounty. Apes split the bag. Number go up.",
    type: "website"
  }
};

export const viewport: Viewport = {
  themeColor: "#26C281",
  width: "device-width",
  initialScale: 1
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${body.variable} ${display.variable} ${brand.variable} ${mono.variable}`}>
      <body>
        <div className="app-bg" aria-hidden="true" />
        <div className="app-glow" aria-hidden="true" />
        <AppKitProviders>{children}</AppKitProviders>
        <Analytics />
      </body>
    </html>
  );
}

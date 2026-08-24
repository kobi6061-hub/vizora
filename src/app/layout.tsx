import type { Metadata, Viewport } from "next";
import {
  Bricolage_Grotesque,
  Geist,
  Geist_Mono,
  Instrument_Serif,
} from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const sans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const mono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const display = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
});

const serif = Instrument_Serif({
  variable: "--font-instrument",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Vizora — Real-estate marketing videos in 5 minutes",
    template: "%s — Vizora",
  },
  description:
    "Upload your renders, photos or property visuals. Vizora turns them into polished real-estate marketing videos, ready to publish in about 5 minutes.",
  applicationName: "Vizora",
  keywords: [
    "AI real estate video generator",
    "image to real estate video",
    "property video maker",
    "real estate marketing video",
    "architectural render to video",
  ],
  openGraph: {
    type: "website",
    siteName: "Vizora",
    title: "Vizora — The AI video studio built for real estate",
    description:
      "Turn property images into marketing videos in 5 minutes. Upload, direct, publish.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Vizora — Real-estate marketing videos in 5 minutes",
    description:
      "Turn property images into marketing videos in 5 minutes. Upload, direct, publish.",
  },
};

export const viewport: Viewport = {
  themeColor: "#0b0b0f",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable} ${display.variable} ${serif.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-ground text-ink">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

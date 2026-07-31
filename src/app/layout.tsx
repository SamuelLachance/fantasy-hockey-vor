import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { PROJECTION_SEASON } from "@/lib/nhl-api";
import { SITE_BRAND, SITE_URL } from "@/lib/site";
import {
  siteDefaultDescription,
  siteDefaultTitle,
} from "@/lib/site-meta";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const defaultTitle = siteDefaultTitle();
const defaultDescription = siteDefaultDescription();

export const viewport: Viewport = {
  themeColor: "#020617",
  colorScheme: "dark",
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: defaultTitle,
  description: defaultDescription,
  keywords: [
    "fantasy hockey",
    "VOR",
    "NHL rankings",
    PROJECTION_SEASON,
    "draft edge",
    "Yahoo fantasy",
    "stacked ensemble",
  ],
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    title: defaultTitle,
    description:
      "Stacked-ensemble VOR rankings for H2H categories — Edge, uncertainty, Yahoo positions.",
    url: SITE_URL,
    siteName: SITE_BRAND,
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary",
    title: defaultTitle,
    description:
      "Stacked-ensemble VOR rankings with draft Edge and calibrated uncertainty.",
  },
  applicationName: SITE_BRAND,
  alternates: {
    canonical: "/",
  },
  category: "sports",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

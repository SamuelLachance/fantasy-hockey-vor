import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { PROJECTION_SEASON } from "@/lib/nhl-api";
import { SITE_BRAND, SITE_SHORT_NAME, SITE_URL } from "@/lib/site";
import {
  siteDefaultDescription,
  siteDefaultTitle,
} from "@/lib/site-meta";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "latin-ext"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin", "latin-ext"],
});

const defaultTitle = siteDefaultTitle();
const defaultDescription = siteDefaultDescription();

export const viewport: Viewport = {
  themeColor: "#020617",
  colorScheme: "dark",
  viewportFit: "cover",
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
    description: defaultDescription,
    url: SITE_URL,
    siteName: SITE_BRAND,
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: defaultTitle,
    description: defaultDescription,
  },
  applicationName: SITE_BRAND,
  appleWebApp: {
    capable: true,
    title: SITE_SHORT_NAME,
    statusBarStyle: "black-translucent",
  },
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

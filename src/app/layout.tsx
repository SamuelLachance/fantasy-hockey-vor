import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  themeColor: "#020617",
  colorScheme: "dark",
};

export const metadata: Metadata = {
  metadataBase: new URL("https://samuellachance.github.io/fantasy-hockey-vor/"),
  title: "Fantasy Hockey VOR | 2026-27 ML Rankings",
  description:
    "2026-27 NHL fantasy hockey Value Over Replacement rankings from a stacked ML ensemble (GBDT + ridge + Marcel), with draft Edge vs synthetic consensus and calibrated uncertainty.",
  openGraph: {
    title: "Fantasy Hockey VOR | 2026-27 ML Rankings",
    description:
      "Stacked-ensemble VOR rankings for H2H categories — Edge, uncertainty, Yahoo positions.",
    url: "https://samuellachance.github.io/fantasy-hockey-vor/",
    siteName: "Fantasy Hockey VOR",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary",
    title: "Fantasy Hockey VOR | 2026-27 ML Rankings",
    description:
      "Stacked-ensemble VOR rankings with draft Edge and calibrated uncertainty.",
  },
  applicationName: "Fantasy Hockey VOR",
  alternates: {
    canonical: "/",
  },
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

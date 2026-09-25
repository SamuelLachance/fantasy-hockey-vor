import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SiteFooter } from "@/components/site/SiteFooter";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SITE_BRAND, SITE_SHORT_NAME, SITE_URL } from "@/lib/site";
import { SITE_TITLE_TEMPLATE, siteDefaultDescription, siteDefaultTitle } from "@/lib/site-meta";
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

// Personal league tools: public files, but never meant for search results.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: defaultTitle, template: SITE_TITLE_TEMPLATE },
  description: defaultDescription,
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
  openGraph: {
    title: defaultTitle,
    description: defaultDescription,
    url: SITE_URL,
    siteName: SITE_BRAND,
    type: "website",
    locale: "fr_CA",
  },
  twitter: {
    card: "summary",
    title: defaultTitle,
    description: defaultDescription,
  },
  applicationName: SITE_BRAND,
  appleWebApp: {
    capable: true,
    title: SITE_SHORT_NAME,
    statusBarStyle: "black-translucent",
  },
  category: "sports",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr-CA" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <a
          href="#contenu"
          className="sr-only z-50 rounded-xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 focus:not-sr-only focus:left-4 focus:top-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200"
        >
          Aller au contenu
        </a>
        <SiteHeader />
        {/* The only <main> of every page: pages render <div>/<section>. */}
        <main id="contenu" tabIndex={-1} className="flex-1 focus:outline-none">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}

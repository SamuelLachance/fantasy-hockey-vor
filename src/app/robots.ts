import type { MetadataRoute } from "next";

export const dynamic = "force-static";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/**
 * Crawlers may fetch the pages (so they can read each page's noindex), but
 * nothing here is meant for search results: no sitemap.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      // Host-root relative; scope under GH Pages project path when set.
      allow: basePath ? `${basePath}/` : "/",
    },
  };
}

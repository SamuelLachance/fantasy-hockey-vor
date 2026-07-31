import type { MetadataRoute } from "next";
import { SITE_ORIGIN } from "@/lib/site";

export const dynamic = "force-static";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      // Host-root relative; scope under GH Pages project path when set.
      allow: basePath ? `${basePath}/` : "/",
    },
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
  };
}

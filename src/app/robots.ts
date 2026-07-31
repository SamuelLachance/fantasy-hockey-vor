import type { MetadataRoute } from "next";

const site = "https://samuellachance.github.io/fantasy-hockey-vor";

export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
    },
    sitemap: `${site}/sitemap.xml`,
    host: site,
  };
}

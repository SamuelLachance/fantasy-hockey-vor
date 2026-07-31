import type { MetadataRoute } from "next";
import { getProjections } from "@/lib/data";
import {
  projectionAgeDays,
  sitemapChangeFrequency,
  sitemapLastModified,
} from "@/lib/projection-age";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const data = getProjections();
  const generatedAt = data.generatedAt;
  const lastModified = sitemapLastModified(
    generatedAt,
    process.env.NEXT_PUBLIC_BUILD_TIME,
  );
  const age = projectionAgeDays(
    generatedAt,
    process.env.NEXT_PUBLIC_BUILD_TIME,
  );
  return [
    {
      url: SITE_URL,
      lastModified,
      changeFrequency: sitemapChangeFrequency(age),
      priority: 1,
    },
  ];
}

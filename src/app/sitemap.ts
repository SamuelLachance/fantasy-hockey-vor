import type { MetadataRoute } from "next";
import { getProjections } from "@/lib/data";
import { projectionAgeDays } from "@/lib/projection-age";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const data = getProjections();
  const generatedAt = data.generatedAt;
  const lastModified = new Date(
    generatedAt ||
      process.env.NEXT_PUBLIC_BUILD_TIME ||
      "2026-07-22T00:00:00.000Z",
  );
  const age = projectionAgeDays(
    generatedAt,
    process.env.NEXT_PUBLIC_BUILD_TIME,
  );
  return [
    {
      url: SITE_URL,
      lastModified,
      changeFrequency: age <= 7 ? "daily" : "weekly",
      priority: 1,
    },
  ];
}

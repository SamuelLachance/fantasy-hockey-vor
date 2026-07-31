import type { MetadataRoute } from "next";
import { getProjections } from "@/lib/data";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const generatedAt = getProjections().generatedAt;
  const lastModified = new Date(
    generatedAt ||
      process.env.NEXT_PUBLIC_BUILD_TIME ||
      "2026-07-22T00:00:00.000Z",
  );
  return [
    {
      url: SITE_URL,
      lastModified,
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}

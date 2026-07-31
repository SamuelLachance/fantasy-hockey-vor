import type { MetadataRoute } from "next";
import { getProjections } from "@/lib/data";

const site = "https://samuellachance.github.io/fantasy-hockey-vor";

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
      url: `${site}/`,
      lastModified,
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}

import type { MetadataRoute } from "next";

const site = "https://samuellachance.github.io/fantasy-hockey-vor";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${site}/`,
      lastModified: new Date(
        process.env.NEXT_PUBLIC_BUILD_TIME || "2026-07-22T00:00:00.000Z",
      ),
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}

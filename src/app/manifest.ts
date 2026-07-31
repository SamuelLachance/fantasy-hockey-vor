import type { MetadataRoute } from "next";
import { SITE_BRAND, SITE_SHORT_NAME } from "@/lib/site";
import { siteManifestDescription } from "@/lib/site-meta";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_BRAND,
    short_name: SITE_SHORT_NAME,
    description: siteManifestDescription(),
    start_url: "./",
    display: "standalone",
    background_color: "#020617",
    theme_color: "#020617",
    lang: "en",
    categories: ["sports", "entertainment"],
    orientation: "any",
    icons: [
      {
        src: "icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "apple-icon.svg",
        sizes: "180x180",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}

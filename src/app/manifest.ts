import type { MetadataRoute } from "next";
import { siteManifestDescription } from "@/lib/site-meta";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Fantasy Hockey VOR",
    short_name: "VOR Hockey",
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

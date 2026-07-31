import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Fantasy Hockey VOR",
    short_name: "VOR Hockey",
    description:
      "2026-27 NHL fantasy hockey VOR rankings from a stacked ML ensemble.",
    start_url: "./",
    display: "standalone",
    background_color: "#020617",
    theme_color: "#020617",
    lang: "en",
  };
}

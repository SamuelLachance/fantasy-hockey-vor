import type { ProjectionsDataset } from "@/lib/types";

const SITE_URL = "https://samuellachance.github.io/fantasy-hockey-vor/";

/** JSON-LD for the rankings homepage (Dataset + WebApplication). */
export function rankingsJsonLd(data: ProjectionsDataset): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebApplication",
        name: "Fantasy Hockey VOR",
        url: SITE_URL,
        applicationCategory: "SportsApplication",
        operatingSystem: "Any",
        description:
          "NHL fantasy hockey Value Over Replacement rankings from a stacked ML ensemble.",
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD",
        },
      },
      {
        "@type": "Dataset",
        name: `${data.season} Fantasy Hockey VOR Rankings`,
        description:
          "Player VOR rankings with draft Edge and calibrated uncertainty for H2H category leagues.",
        url: SITE_URL,
        dateModified: data.generatedAt,
        creator: {
          "@type": "Person",
          name: "Samuel Lachance",
          url: "https://github.com/SamuelLachance",
        },
        distribution: [
          {
            "@type": "DataDownload",
            encodingFormat: "application/json",
            contentUrl: `${SITE_URL}player-details.json`,
          },
        ],
        variableMeasured: [
          "VOR",
          "draft Edge",
          "games played",
          "skater and goalie counting stats",
        ],
      },
    ],
  };
}

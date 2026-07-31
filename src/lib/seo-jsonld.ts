import type { ProjectionsDataset } from "@/lib/types";
import { SITE_URL } from "@/lib/site";

const FAQ_ENTRIES: ReadonlyArray<{ q: string; a: string }> = [
  {
    q: "What is Fantasy Hockey VOR?",
    a: "Value Over Replacement ranks players by how much fantasy production they add above a replacement-level starter at their Yahoo-eligible position.",
  },
  {
    q: "What does Edge mean?",
    a: "Edge is consensus market rank minus model rank. Positive Edge means the model likes a player more than the synthetic consensus.",
  },
  {
    q: "What is Σσ?",
    a: "Σσ is calibrated aggregate projection uncertainty (1σ). Lower values mean the model is more confident in the projection.",
  },
  {
    q: "What does Starters mean for goalies?",
    a: "Starters hides depth goalies projected under 8 games played. Use All goalies (or Shift+G) when you need tandem backups and streaming options.",
  },
  {
    q: "What keyboard shortcuts does the board support?",
    a: "Press ? for the full list. Highlights: / search, f filters, r reset, l copy link, m load more, [ and ] cycle positions, j/k move rows, v/e/u/g sort, Shift+G toggle starter goalies.",
  },
];

/** JSON-LD for the rankings homepage (Dataset + WebApplication + FAQ). */
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
          sameAs: ["https://github.com/SamuelLachance"],
        },
        about: {
          "@type": "Thing",
          name: "National Hockey League",
          alternateName: "NHL",
        },
        license: "https://opensource.org/licenses/MIT",
        isAccessibleForFree: true,
        keywords: [
          "fantasy hockey",
          "VOR",
          "NHL rankings",
          data.season,
          `${data.players.length} players`,
        ],
        measurementTechnique: data.projectionEngine ?? "stacked-ensemble",
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
          "Σσ uncertainty",
          "games played",
          "skater and goalie counting stats",
        ],
      },
      {
        "@type": "FAQPage",
        mainEntity: FAQ_ENTRIES.map(({ q, a }) => ({
          "@type": "Question",
          name: q,
          acceptedAnswer: {
            "@type": "Answer",
            text: a,
          },
        })),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Fantasy Hockey VOR",
            item: SITE_URL,
          },
          {
            "@type": "ListItem",
            position: 2,
            name: `${data.season} Rankings`,
            item: `${SITE_URL}#rankings`,
          },
        ],
      },
      {
        "@type": "HowTo",
        name: "How to use Fantasy Hockey VOR rankings",
        description:
          "Filter, sort, and deep-link the board to draft with VOR, Edge, and Σσ.",
        step: [
          {
            "@type": "HowToStep",
            name: "Open the board",
            text: "Jump to #rankings or press End to focus search.",
          },
          {
            "@type": "HowToStep",
            name: "Filter by position and stats",
            text: "Use position tabs or [ / ], open Stats with f, and set min/max ranges.",
          },
          {
            "@type": "HowToStep",
            name: "Sort and compare risk",
            text: "Press v/e/u/g for VOR / Edge / Σσ / GP. Expand a row for category z and notes.",
          },
          {
            "@type": "HowToStep",
            name: "Share the view",
            text: "Press l to copy a link that preserves filters, sort, and expanded player.",
          },
        ],
      },
    ],
  };
}

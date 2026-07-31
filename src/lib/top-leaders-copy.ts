/** Landmark label for the leaders section. */
export function topLeadersSectionLabel(): string {
  return "Top fantasy hockey leaders";
}

export const TOP_LEADERS_COPY = {
  overallVor: { title: "Overall VOR Leaders" },
  topEdge: {
    title: "Top Edge (undervalued)",
    description:
      "Consensus rank − model rank. Positive = model likes them more than the synthetic market.",
  },
  steadiest: {
    title: "Steadiest (low Σσ)",
    description:
      "Among skaters with VOR ≥ 2, the five with the tightest Σσ bands.",
  },
  byPosition: { title: "By Position" },
  boardView: "Board view",
  sortByEdge: "Sort by Edge",
  sortBySigma: "Sort by Σσ",
  top3: "Top 3",
} as const;

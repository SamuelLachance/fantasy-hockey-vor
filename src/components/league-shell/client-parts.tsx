"use client";

/**
 * Every league's client code, split per piece: one dynamic route serves
 * all leagues and tabs, and a static import would put the Fantrax planner
 * and the Yahoo draft helper in every tab's bundle. Each piece below is its
 * own chunk, loaded only by the pages that render it (still prerendered:
 * the HTML is complete without JavaScript).
 */
import dynamic from "next/dynamic";

// ---- fantrax-points
export const FantraxShellPart = dynamic(() =>
  import("@/components/fantrax/FantraxLeagueProvider").then((m) => m.FantraxLeagueProvider),
);
export const FantraxHeaderPart = dynamic(() =>
  import("@/components/fantrax/FantraxLeagueHeader").then((m) => m.FantraxLeagueHeader),
);
export const FantraxTodayPart = dynamic(() => import("@/components/fantrax/FantraxTodayTab").then((m) => m.FantraxTodayTab));
export const FantraxDraftPart = dynamic(() => import("@/components/fantrax/FantraxDraftTab").then((m) => m.FantraxDraftTab));
export const FantraxPlayersPart = dynamic(() =>
  import("@/components/fantrax/FantraxPlayersTab").then((m) => m.FantraxPlayersTab),
);
export const FantraxWaiversPart = dynamic(() =>
  import("@/components/fantrax/FantraxWaiversTab").then((m) => m.FantraxWaiversTab),
);
export const FantraxTeamPart = dynamic(() => import("@/components/fantrax/FantraxTeamTab").then((m) => m.FantraxTeamTab));

// ---- yahoo-categories
export const CategoryDraftPart = dynamic(() => import("@/components/draft/CategoryDraftTab").then((m) => m.CategoryDraftTab));
export const CategoryPlayersPart = dynamic(() =>
  import("@/components/draft/category-table").then((m) => m.CategoryPlayersTable),
);
export const CategoryTeamPart = dynamic(() => import("@/components/draft/CategoryTeamTab").then((m) => m.CategoryTeamTab));

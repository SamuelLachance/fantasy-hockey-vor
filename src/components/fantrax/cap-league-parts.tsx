"use client";

import dynamic from "next/dynamic";
import type { LeagueParts } from "@/lib/fantrax/league-pack";

/**
 * The cap league's own pieces (Slapshot), handed to the shared tabs through
 * its league pack: the shared tabs never name them, so their loaders ship in
 * this league's shell chunk only. Each body is still its own chunk, fetched
 * where it renders.
 */
const SlapshotTurnCue = dynamic(() => import("./SlapshotDraftBoard").then((m) => m.SlapshotTurnCue));
const SlapshotDraftBoard = dynamic(() => import("./SlapshotDraftBoard").then((m) => m.SlapshotDraftBoard));
const MethodNote = dynamic(() => import("./SlapshotMethodNote").then((m) => m.SlapshotMethodNote));
const LightPageLink = dynamic(() => import("./SlapshotMethodNote").then((m) => m.SlapshotLightPageLink));
const SlapshotTeamCap = dynamic(() => import("./SlapshotTeamCap").then((m) => m.SlapshotTeamCap), { ssr: false });
const SalaryNode = dynamic(() => import("./ContractCells").then((m) => m.SalaryNode));
const ContractEndNode = dynamic(() => import("./ContractCells").then((m) => m.ContractEndNode));
const Legend = dynamic(() => import("./ContractCells").then((m) => m.SlapshotLegend));

/** Under the Repêchage table: the method note, then the light page's link. */
function DraftFooter() {
  return (
    <>
      <MethodNote />
      <LightPageLink />
    </>
  );
}

export const CAP_LEAGUE_PARTS: LeagueParts = {
  DraftCue: SlapshotTurnCue,
  DraftBoard: SlapshotDraftBoard,
  DraftFooter,
  TeamCap: SlapshotTeamCap,
  MethodNote,
  SalaryNode,
  ContractEndNode,
  Legend,
};

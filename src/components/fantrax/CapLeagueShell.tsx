"use client";

import { useCallback, useEffect, useMemo, useState, type ComponentProps } from "react";
import { CAP_LEAGUE_COPY } from "@/lib/fantrax/cap-league-copy";
import { fantraxLeague } from "@/lib/fantrax/config";
import { loadContracts } from "@/lib/fantrax/contracts-client";
import { needsLeagueModel, type LeagueModel, type LeaguePack } from "@/lib/fantrax/league-pack";
import type { ContractsFile } from "@/lib/fantrax/salary-cap";
import { CAP_LEAGUE_PARTS } from "./cap-league-parts";
import type { LoadState } from "./fantrax-league-context";
import { FantraxLeagueProvider } from "./FantraxLeagueProvider";

type ProviderProps = ComponentProps<typeof FantraxLeagueProvider>;

/** Its words and pieces, synchronous: the prerendered HTML says them too. */
const PACK: LeaguePack = { copy: CAP_LEAGUE_COPY, parts: CAP_LEAGUE_PARTS };

/**
 * The provider of a league that needs the cap-league pack (Slapshot: salary
 * cap, per-game locks, points over replacement, its own words). Its own entry
 * in client-parts.tsx, chosen by the server adapter per league, so this chunk
 * — the pack, the contracts read and the model's loader — is loaded by that
 * league's tabs only, never by Captains'.
 */
export function CapLeagueShell(
  props: Omit<ProviderProps, "pack" | "model" | "modelState" | "contracts" | "contractsState" | "retryExtras">,
) {
  const config = useMemo(() => fantraxLeague(props.slug), [props.slug]);
  const [attempt, setAttempt] = useState(0);

  // ---- the contracts: their own read, so neither the plan nor the live picks
  // wait for them, and a failure is said as such (« Actualiser » retries).
  const [contracts, setContracts] = useState<ContractsFile | null>(null);
  const [contractsState, setContractsState] = useState<LoadState>(config.salaryCap ? "loading" : "ready");
  useEffect(() => {
    if (!config.salaryCap) return;
    let cancelled = false;
    loadContracts(config).then(
      (c) => {
        if (cancelled) return;
        setContracts(c);
        setContractsState("ready");
      },
      () => {
        if (!cancelled) setContractsState("error");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [config, attempt]);

  // ---- the model (points over replacement, the planner's own rules): one
  // chunk, fetched at once, alongside the snapshot.
  const needsModel = needsLeagueModel(config);
  const [model, setModel] = useState<LeagueModel | null>(null);
  const [modelState, setModelState] = useState<LoadState>(needsModel ? "loading" : "ready");
  useEffect(() => {
    if (!needsModel) return;
    let cancelled = false;
    import("@/lib/fantrax/cap-league-model").then(
      (m) => {
        if (cancelled) return;
        setModel(m.CAP_LEAGUE_MODEL);
        setModelState("ready");
      },
      () => {
        if (!cancelled) setModelState("error");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [needsModel, attempt]);

  // « Actualiser » after a failure: read whatever failed again. The model's
  // state stays "error" while it retries, so the live read keeps its fallback.
  const retryExtras = useCallback(() => {
    setContractsState((s) => (s === "error" ? "loading" : s));
    setAttempt((n) => n + 1);
  }, []);

  return (
    <FantraxLeagueProvider
      {...props}
      pack={PACK}
      model={model}
      modelState={modelState}
      contracts={contracts}
      contractsState={contractsState}
      retryExtras={retryExtras}
    />
  );
}

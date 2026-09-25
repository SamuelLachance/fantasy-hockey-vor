"use client";

/**
 * Snake's verdicts store for the chips and tables below it: the provider
 * and its hooks, without the chips themselves (and so without Snake's copy
 * and URL helpers). The Captains league provider only needs this part: its
 * chunk no longer carries a second copy of the chips' code.
 */
import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";
import type { SnakeFantraxEntry, SnakeFantraxFile, SnakeNhlEntry, SnakeNhlFile } from "@/lib/snake/types";
import {
  getVerdictRows,
  getVerdictStatus,
  subscribeVerdicts,
  type VerdictKind,
  type VerdictStatus,
} from "@/lib/snake/verdicts";

type FxRows = SnakeFantraxFile["rows"];
type NhlRows = SnakeNhlFile["rows"];

interface VerdictsValue {
  fx: FxRows | null;
  fxStatus: VerdictStatus;
  nhl: NhlRows | null;
  nhlStatus: VerdictStatus;
}

const EMPTY: VerdictsValue = { fx: null, fxStatus: "idle", nhl: null, nhlStatus: "idle" };
const SnakeVerdictsContext = createContext<VerdictsValue>(EMPTY);

const noop = () => {};
const serverRows = () => null;
const serverStatus = (): VerdictStatus => "idle";
const serverReady = (): VerdictStatus => "ready";

/**
 * Snake's verdicts for one kind of player id (Fantrax or NHL), for every
 * chip and table below. First paint uses the build-time seed; the file is
 * fetched right away (the verdicts belong to the tables), unless the seed
 * is `complete` for the page. Providers nest: an NHL one inside a Fantrax
 * one keeps both.
 */
export function SnakeVerdictsProvider({
  kind,
  seed,
  complete = false,
  children,
}: {
  kind: VerdictKind;
  seed: FxRows | NhlRows;
  /** The seed covers every player the page shows: never fetch. */
  complete?: boolean;
  children: ReactNode;
}) {
  const parent = useContext(SnakeVerdictsContext);
  const subscribe = useCallback((cb: () => void) => (complete ? noop : subscribeVerdicts(kind, cb)), [kind, complete]);
  const rows = useSyncExternalStore(
    subscribe,
    () => (complete ? null : getVerdictRows(kind)),
    serverRows,
  );
  // A complete seed is the whole data, in the prerendered page too.
  const status = useSyncExternalStore(
    subscribe,
    () => (complete ? "ready" : getVerdictStatus(kind)),
    complete ? serverReady : serverStatus,
  );
  const value = useMemo<VerdictsValue>(() => {
    const merged = rows ? { ...seed, ...rows } : seed;
    return kind === "fx"
      ? { ...parent, fx: merged as FxRows, fxStatus: status }
      : { ...parent, nhl: merged as NhlRows, nhlStatus: status };
  }, [parent, kind, seed, rows, status]);
  return <SnakeVerdictsContext.Provider value={value}>{children}</SnakeVerdictsContext.Provider>;
}

/** Every Fantrax-keyed verdict on hand (seed + file) and whether the file is in. */
export function useSnakeFantraxRows(): { rows: FxRows | null; status: VerdictStatus } {
  const v = useContext(SnakeVerdictsContext);
  return { rows: v.fx, status: v.fxStatus };
}

/** Every NHL-keyed verdict on hand (seed + file) and whether the file is in (always, with a complete seed). */
export function useSnakeNhlRows(): { rows: NhlRows | null; status: VerdictStatus } {
  const v = useContext(SnakeVerdictsContext);
  return { rows: v.nhl, status: v.nhlStatus };
}

export function useSnakeFantrax(id: string | null | undefined): SnakeFantraxEntry | null {
  const rows = useContext(SnakeVerdictsContext).fx;
  return id && rows ? (rows[id] ?? null) : null;
}

export function useSnakeNhl(id: number | string | null | undefined): SnakeNhlEntry | null {
  const rows = useContext(SnakeVerdictsContext).nhl;
  return id !== null && id !== undefined && rows ? (rows[String(id)] ?? null) : null;
}

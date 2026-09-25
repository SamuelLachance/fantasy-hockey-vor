"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { TabSearchContext } from "@/components/league-shell/tab-search";
// The store only (not the chips): the tabs' chunks carry the chips and Snake's copy.
import { SnakeVerdictsProvider } from "@/components/snake/SnakeVerdictsContext";
import { bestFpg, buildDailyPlan, type DailyPlan } from "@/lib/fantrax/daily-plan";
import { targetRosterPeriod } from "@/lib/fantrax/dates";
import {
  fetchLiveOverlay,
  LIVE_DRAFT_POLL_MS,
  loadLeagueSnapshot,
  pickTeam,
  readStoredTeam,
  storeTeam,
  teamSearch,
  type LeagueSnapshotBundle,
} from "@/lib/fantrax/league-client";
import { withLiveOverlay, type LiveOverlay } from "@/lib/fantrax/live";
import type { RosterLimits } from "@/lib/fantrax/config";
import type { SnakeFantraxFile } from "@/lib/snake/types";
import { FantraxLeagueContext, type FantraxLeagueValue, type LoadState } from "./fantrax-league-context";
import type { PlayerLookup } from "./LeagueCard";

interface FantraxLeagueProviderProps {
  /** Default team's plan baked at sync time (first paint, no JS needed). */
  initialPlan: DailyPlan;
  /** Sorted on the server so the options hydrate identically. */
  teams: Array<{ id: string; name: string }>;
  leagueName: string;
  limits: RosterLimits;
  defaultTeamId: string;
  /** Snake verdicts for the baked plan's players (the full file loads at once). */
  snakeSeed: SnakeFantraxFile["rows"];
  /** The build saw `public/fantrax/dynasty.json`. */
  hasDynasty: boolean;
  children: ReactNode;
}

/** Reads `?team=` (inside Suspense, as static export requires) and reports it up. */
function TeamFromUrl({ onTeam }: { onTeam: (teamId: string | null) => void }) {
  const params = useSearchParams();
  const team = params.get("team");
  useEffect(() => {
    onTeam(team);
  }, [team, onTeam]);
  return null;
}

const CLOCK_TICK_MS = 30_000;

/**
 * Everything the Captains Dynasty tabs share, held in the league layout so
 * it survives tab changes: the chosen team, the baked snapshot, the live
 * rosters and draft picks from Fantrax (polled every 90 s while the draft
 * runs and the page is visible), the clock, and the same pure planner
 * re-run in the browser for whichever team is picked. First paint is the
 * default team's baked plan; "now" only exists in effects (React purity).
 */
export function FantraxLeagueProvider({
  initialPlan,
  teams,
  leagueName,
  limits,
  defaultTeamId,
  snakeSeed,
  hasDynasty,
  children,
}: FantraxLeagueProviderProps) {
  const [teamId, setTeamId] = useState(defaultTeamId);
  const [nowMs, setNowMs] = useState<number | null>(null);
  const [planNowMs, setPlanNowMs] = useState<number | null>(null);
  const [bundle, setBundle] = useState<LeagueSnapshotBundle | null>(null);
  const [bundleState, setBundleState] = useState<LoadState>("loading");
  const [bundleAttempt, setBundleAttempt] = useState(0);
  const [live, setLive] = useState<LiveOverlay | null>(null);
  const [liveState, setLiveState] = useState<LoadState>("loading");
  const [refreshCount, setRefreshCount] = useState(0);

  // ?team= wins, then the team last picked on this device, then the default.
  // A team named by the address is remembered too: the tab links drop
  // `?team=` for the user's own team (home page links carry it), and the
  // next tab must not fall back to a team peeked at earlier.
  const onUrlTeam = useCallback(
    (fromUrl: string | null) => {
      const picked = pickTeam([fromUrl, readStoredTeam()], teams, defaultTeamId);
      if (fromUrl && picked === fromUrl) storeTeam(picked);
      setTeamId(picked);
    },
    [teams, defaultTeamId],
  );

  const chooseTeam = useCallback(
    (next: string) => {
      setTeamId(next);
      storeTeam(next);
      try {
        // Native History API: Next's patched replaceState soft-navigates,
        // which scrolls to top on static export. The tab links carry the
        // team from state (TabSearchContext), not from the URL.
        const url = `${window.location.pathname}${teamSearch(window.location.search, next, defaultTeamId)}${window.location.hash}`;
        History.prototype.replaceState.call(window.history, window.history.state, "", url);
      } catch {
        // Sandboxed frames can refuse history writes; the choice still applies.
      }
    },
    [defaultTeamId],
  );

  // ---- baked snapshot (values / state / schedule / league)
  useEffect(() => {
    let cancelled = false;
    loadLeagueSnapshot().then(
      (b) => {
        if (cancelled) return;
        // Plan right away rather than on the next clock tick: background
        // tabs throttle timers, promise callbacks are not.
        const now = Date.now();
        setBundle(b);
        setBundleState("ready");
        setNowMs(now);
        setPlanNowMs((prev) => prev ?? now);
      },
      () => {
        if (!cancelled) setBundleState("error");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [bundleAttempt]);

  // ---- rosters and picks: the snapshot's, the live read over them
  const state = useMemo(() => (bundle ? withLiveOverlay(bundle.state, live) : null), [bundle, live]);

  // ---- plan (browser re-run once the snapshot is in; baked plan until then)
  const computed = useMemo(() => {
    if (!bundle || !state || planNowMs === null) return null;
    return buildDailyPlan({ ...bundle, state, teamId, nowMs: planNowMs });
  }, [bundle, state, teamId, planNowMs]);
  const plan = computed ?? (teamId === initialPlan.teamId ? initialPlan : null);
  const lockMs = plan?.target ? Date.parse(plan.target.start) : null;

  // ---- clock: countdowns every 30 s; re-plan once the shown lineup locks
  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      setNowMs(now);
      setPlanNowMs((prev) => (prev === null || (lockMs !== null && now >= lockMs) ? now : prev));
    };
    const first = window.setTimeout(tick, 0);
    const id = window.setInterval(tick, CLOCK_TICK_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [lockMs]);

  // ---- live rosters + draft picks for the lineup period that locks next
  const livePeriod = useMemo(() => {
    if (!bundle || planNowMs === null) return null;
    const periods = bundle.league.rosterPeriods;
    return (targetRosterPeriod(periods, planNowMs) ?? periods[periods.length - 1])?.number ?? null;
  }, [bundle, planNowMs]);

  useEffect(() => {
    if (livePeriod === null) return;
    let cancelled = false;
    fetchLiveOverlay(livePeriod, { force: refreshCount > 0 }).then(
      (o) => {
        if (cancelled) return;
        setLive(o);
        setLiveState("ready");
      },
      () => {
        if (!cancelled) setLiveState("error");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [livePeriod, refreshCount]);

  // While the draft runs, poll picks (only when the tab is visible).
  const draftOpen = !!plan?.draft;
  useEffect(() => {
    if (!draftOpen || livePeriod === null) return;
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      fetchLiveOverlay(livePeriod, { force: true }).then(
        (o) => {
          setLive(o);
          setLiveState("ready");
        },
        () => setLiveState("error"),
      );
    }, LIVE_DRAFT_POLL_MS);
    return () => window.clearInterval(id);
  }, [draftOpen, livePeriod]);

  // Busy only while a request is really in flight: the snapshot, or the live
  // read once the snapshot is in (without it there is no period to read).
  const busy = bundleState === "loading" || (bundleState === "ready" && liveState === "loading");

  const refresh = useCallback(() => {
    setLiveState("loading");
    setPlanNowMs(Date.now());
    if (bundleState === "error") {
      setBundleState("loading");
      setBundleAttempt((n) => n + 1);
    }
    setRefreshCount((n) => n + 1);
  }, [bundleState]);

  const player = useCallback<PlayerLookup>(
    (id) => {
      if (!id) return undefined;
      const p = plan?.players[id];
      if (p) return p;
      const v = bundle?.values.players[id];
      return v ? { n: v.n, t: v.t, e: v.e, st: "", fpg: bestFpg(v), src: v.src, age: v.age } : undefined;
    },
    [plan, bundle],
  );
  const teamName = useCallback(
    (id: string) => teams.find((t) => t.id === id)?.name ?? "Équipe inconnue",
    [teams],
  );

  const value = useMemo<FantraxLeagueValue>(
    () => ({
      teams,
      leagueName,
      limits,
      defaultTeamId,
      teamId,
      chooseTeam,
      plan,
      bundle,
      bundleState,
      state,
      live,
      liveState,
      busy,
      nowMs,
      refresh,
      player,
      teamName,
      hasDynasty,
    }),
    [teams, leagueName, limits, defaultTeamId, teamId, chooseTeam, plan, bundle, bundleState, state, live, liveState, busy, nowMs, refresh, player, teamName, hasDynasty],
  );
  // Tab links keep a non-default team (from state: the URL write above is
  // invisible to useSearchParams).
  const tabSearch = teamSearch("", teamId, defaultTeamId);

  return (
    <FantraxLeagueContext.Provider value={value}>
      <TabSearchContext.Provider value={tabSearch}>
        <SnakeVerdictsProvider kind="fx" seed={snakeSeed}>
          <Suspense fallback={null}>
            <TeamFromUrl onTeam={onUrlTeam} />
          </Suspense>
          {children}
        </SnakeVerdictsProvider>
      </TabSearchContext.Provider>
    </FantraxLeagueContext.Provider>
  );
}

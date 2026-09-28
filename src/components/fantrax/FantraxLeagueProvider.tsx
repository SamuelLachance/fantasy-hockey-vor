"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { TabSearchContext } from "@/components/league-shell/tab-search";
// The store only (not the chips): the tabs' chunks carry the chips and Snake's copy.
import { SnakeVerdictsProvider } from "@/components/snake/SnakeVerdictsContext";
import { bestFpg, buildDailyPlan, indexSchedule, lineupTarget, seasonFp, type DailyPlan } from "@/lib/fantrax/daily-plan";
import {
  draftPollMs,
  fetchLiveOverlay,
  LIVE_DRAFT_POLL_MS,
  loadContracts,
  loadLeagueSnapshot,
  pickTeam,
  readStoredTeam,
  storeTeam,
  teamSearch,
  type LeagueSnapshotBundle,
} from "@/lib/fantrax/league-client";
import { draftFreshness, withLiveOverlay, type LiveOverlay } from "@/lib/fantrax/live";
import { turnCueMaxAgeMs } from "@/lib/fantrax/turn-cue";
import {
  DEFAULT_DYNASTY_MODE,
  DYNASTY_MODE_PARAM,
  dynastyModeSearch,
  parseDynastyMode,
  type DynastyMode,
} from "@/lib/fantrax/dynasty-mode";
import { canRankByPoints, fantraxLeague, type RosterLimits } from "@/lib/fantrax/config";
import type { ContractsFile } from "@/lib/fantrax/salary-cap";
import type { SnakeFantraxFile } from "@/lib/snake/types";
import { FantraxLeagueContext, type FantraxLeagueValue, type LoadState } from "./fantrax-league-context";
import type { PlayerLookup } from "./LeagueCard";

interface FantraxLeagueProviderProps {
  /** Registry slug of the league being shown; picks its engine config. */
  slug: string;
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

/** Reads `?team=` and `?mode=` (inside Suspense, as static export requires) and reports them up. */
function LeagueFromUrl({
  onTeam,
  onMode,
}: {
  onTeam: (teamId: string | null) => void;
  onMode: (mode: DynastyMode) => void;
}) {
  const params = useSearchParams();
  const team = params.get("team");
  const mode = parseDynastyMode(params.get(DYNASTY_MODE_PARAM));
  useEffect(() => {
    onTeam(team);
  }, [team, onTeam]);
  useEffect(() => {
    onMode(mode);
  }, [mode, onMode]);
  return null;
}

/** Native History API: Next's patched replaceState soft-navigates, which scrolls to top on static export. */
function replaceSearch(search: string): void {
  try {
    const url = `${window.location.pathname}${search}${window.location.hash}`;
    History.prototype.replaceState.call(window.history, window.history.state, "", url);
  } catch {
    // Sandboxed frames can refuse history writes; the choice still applies.
  }
}

const CLOCK_TICK_MS = 30_000;
/** Back on the tab: read Fantrax at once unless the last read is this recent. */
const VISIBLE_REFRESH_AFTER_MS = 5_000;

// The tab-title cue and the opt-in alert while a draft runs: client-only and
// its own chunk, loaded once a draft is open (never in the prerendered HTML).
const DraftTurnWatcher = dynamic(() => import("./DraftTurnWatcher").then((m) => m.DraftTurnWatcher), { ssr: false });

/**
 * Everything one Fantrax points league's tabs share, held in the league layout
 * so it survives tab changes: the chosen team, the baked snapshot, the live
 * rosters and draft picks from Fantrax (polled every 90 s while the draft is
 * open, 20 s in a league whose config asks for it; a running draft keeps
 * polling in a background tab, whose title carries « C’EST À TOI »), the
 * clock, and the same pure planner re-run in the browser for whichever team
 * is picked. First paint is the default team's
 * baked plan; "now" only exists in effects (React purity).
 *
 * Every read is scoped to `slug`'s config, so two Fantrax leagues in one
 * session never share a snapshot, a live overlay or a remembered team.
 */
export function FantraxLeagueProvider({
  slug,
  initialPlan,
  teams,
  leagueName,
  limits,
  defaultTeamId,
  snakeSeed,
  hasDynasty,
  children,
}: FantraxLeagueProviderProps) {
  const config = useMemo(() => fantraxLeague(slug), [slug]);
  const [teamId, setTeamId] = useState(defaultTeamId);
  const [mode, setMode] = useState<DynastyMode>(DEFAULT_DYNASTY_MODE);
  const [nowMs, setNowMs] = useState<number | null>(null);
  const [planNowMs, setPlanNowMs] = useState<number | null>(null);
  const [baseBundle, setBundle] = useState<LeagueSnapshotBundle | null>(null);
  const [bundleState, setBundleState] = useState<LoadState>("loading");
  const [bundleAttempt, setBundleAttempt] = useState(0);
  const [contracts, setContracts] = useState<ContractsFile | null>(null);
  const [contractsState, setContractsState] = useState<LoadState>(config.salaryCap ? "loading" : "ready");
  const [contractsAttempt, setContractsAttempt] = useState(0);
  const [live, setLive] = useState<LiveOverlay | null>(null);
  const [liveState, setLiveState] = useState<LoadState>("loading");
  const [refreshCount, setRefreshCount] = useState(0);

  // ?team= wins, then the team last picked on this device, then the default.
  // A team named by the address is remembered too: the tab links drop
  // `?team=` for the user's own team (home page links carry it), and the
  // next tab must not fall back to a team peeked at earlier.
  const onUrlTeam = useCallback(
    (fromUrl: string | null) => {
      const picked = pickTeam([fromUrl, readStoredTeam(config)], teams, defaultTeamId);
      if (fromUrl && picked === fromUrl) storeTeam(picked, config);
      setTeamId(picked);
    },
    [teams, defaultTeamId, config],
  );

  const chooseTeam = useCallback(
    (next: string) => {
      setTeamId(next);
      storeTeam(next, config);
      // The tab links carry the team from state (TabSearchContext), not from the URL.
      replaceSearch(teamSearch(window.location.search, next, defaultTeamId));
    },
    [defaultTeamId, config],
  );

  // The dynasty mode: from the address (Back / Forward, a shared link), or picked on a tab.
  const onUrlMode = useCallback((m: DynastyMode) => setMode(m), []);
  const chooseMode = useCallback((next: DynastyMode) => {
    setMode(next);
    replaceSearch(dynastyModeSearch(window.location.search, next));
  }, []);

  // ---- baked snapshot (values / state / schedule / league)
  useEffect(() => {
    let cancelled = false;
    loadLeagueSnapshot(config).then(
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
  }, [bundleAttempt, config]);

  // ---- a salary-cap league's contracts: their own read, so neither the
  // plan nor the live picks wait for them, and a failure is said as such.
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
  }, [config, contractsAttempt]);
  const bundle = useMemo(() => (baseBundle ? { ...baseBundle, contracts } : null), [baseBundle, contracts]);

  // ---- rosters and picks: the snapshot's, the live read over them
  const state = useMemo(() => (baseBundle ? withLiveOverlay(baseBundle.state, live) : null), [baseBundle, live]);

  /**
   * Points over replacement for the whole projected pool, from the LEAGUE's
   * depth: the replacement level is a property of its starting seats, so it is
   * built from the snapshot and never moves with the live picks (`state` is
   * deliberately not a dependency). The model (`points-vor.ts` and its seat
   * fill) is its own chunk, fetched only by a league it covers: Captains, whose
   * captain slot it cannot rank, never loads it. Until it is in, the page keeps
   * the baked plan (`vorReady`), so the board never flashes another order.
   */
  const needsVor = canRankByPoints(config);
  const [vorModel, setVorModel] = useState<typeof import("@/lib/fantrax/points-vor") | null>(null);
  useEffect(() => {
    if (!needsVor) return;
    let cancelled = false;
    import("@/lib/fantrax/points-vor").then(
      (m) => {
        if (!cancelled) setVorModel(m);
      },
      () => {
        // Chunk unreachable: the baked plan stays (Actualiser reloads nothing here; a reload does).
      },
    );
    return () => {
      cancelled = true;
    };
  }, [needsVor]);
  const vorReady = !needsVor || !!vorModel;
  const vor = useMemo(
    () =>
      baseBundle && vorModel
        ? vorModel.leagueVor(
            config,
            baseBundle.values.players,
            (id) => seasonFp(baseBundle.values.players[id]!, config),
            baseBundle.league.slotCounts,
          )
        : null,
    [baseBundle, vorModel, config],
  );

  // ---- plan (browser re-run once the snapshot is in; baked plan until then)
  const computed = useMemo(() => {
    if (!bundle || !state || planNowMs === null || !vorReady) return null;
    return buildDailyPlan({ ...bundle, state, teamId, nowMs: planNowMs, config, vor, contracts: bundle.contracts });
  }, [bundle, state, teamId, planNowMs, config, vor, vorReady]);
  const plan = computed ?? (teamId === initialPlan.teamId ? initialPlan : null);
  // A game-lock league re-plans at each of its players' locks (locked players
  // then stay put); a period-lock league when the whole lineup locks.
  const lockAt = plan?.locks ? plan.locks.next : plan?.target?.start;
  const lockMs = lockAt ? Date.parse(lockAt) : null;

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
    if (!baseBundle || planNowMs === null) return null;
    const periods = baseBundle.league.rosterPeriods;
    const target = lineupTarget(periods, indexSchedule(baseBundle.schedule, periods), planNowMs, config);
    return (target ?? periods[periods.length - 1])?.number ?? null;
  }, [baseBundle, planNowMs, config]);

  // The last live read, for the next one: a read whose draft half fails keeps
  // this draft (never the baked one). Refs, not state: the reads run from
  // timers and must not restart when it changes.
  const liveRef = useRef<LiveOverlay | null>(null);
  const liveInFlight = useRef(false);
  useEffect(() => {
    liveRef.current = live;
  }, [live]);

  useEffect(() => {
    if (livePeriod === null) return;
    let cancelled = false;
    liveInFlight.current = true;
    fetchLiveOverlay(livePeriod, { force: refreshCount > 0, config, prev: liveRef.current })
      .then(
        (o) => {
          if (cancelled) return;
          setLive(o);
          setLiveState("ready");
        },
        () => {
          if (!cancelled) setLiveState("error");
        },
      )
      .finally(() => {
        liveInFlight.current = false;
      });
    return () => {
      cancelled = true;
    };
  }, [livePeriod, refreshCount, config]);

  // While the draft is open, poll picks. A RUNNING draft keeps polling in a
  // background tab (the browser stretches its timers to about once a
  // minute): that tab is the one whose title must say « C’EST À TOI ».
  // Coming back to the tab reads at once. One read at a time.
  const draftOpen = !!plan?.draft;
  const draftRunning = plan?.draft?.state === "running";
  useEffect(() => {
    if (!draftOpen || livePeriod === null) return;
    const poll = () => {
      if (liveInFlight.current) return;
      if (document.visibilityState !== "visible" && !draftRunning) return;
      liveInFlight.current = true;
      fetchLiveOverlay(livePeriod, { force: true, config, prev: liveRef.current })
        .then(
          (o) => {
            setLive(o);
            setLiveState("ready");
          },
          () => setLiveState("error"),
        )
        .finally(() => {
          liveInFlight.current = false;
        });
    };
    const id = window.setInterval(poll, draftPollMs(config) || LIVE_DRAFT_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const last = liveRef.current ? Date.parse(liveRef.current.fetchedAt) : 0;
      if (!(Date.now() - last < VISIBLE_REFRESH_AFTER_MS)) poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [draftOpen, draftRunning, livePeriod, config]);

  // Is the draft on screen the latest live read, an older live one (the last
  // read's draft half failed), or the build's? The turn cue needs a live one.
  const draftLive = useMemo(
    () => draftFreshness(live, liveState, nowMs, turnCueMaxAgeMs(draftPollMs(config) || LIVE_DRAFT_POLL_MS)),
    [live, liveState, nowMs, config],
  );

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
    if (contractsState === "error") {
      setContractsState("loading");
      setContractsAttempt((n) => n + 1);
    }
    setRefreshCount((n) => n + 1);
  }, [bundleState, contractsState]);

  const player = useCallback<PlayerLookup>(
    (id) => {
      if (!id) return undefined;
      const p = plan?.players[id];
      if (p) return p;
      const v = bundle?.values.players[id];
      return v ? { n: v.n, t: v.t, e: v.e, st: "", fpg: bestFpg(v, config), src: v.src, age: v.age } : undefined;
    },
    [plan, bundle, config],
  );
  const teamName = useCallback(
    (id: string) => teams.find((t) => t.id === id)?.name ?? "Équipe inconnue",
    [teams],
  );

  const value = useMemo<FantraxLeagueValue>(
    () => ({
      config,
      teams,
      leagueName,
      limits,
      defaultTeamId,
      teamId,
      chooseTeam,
      plan,
      bundle,
      bundleState,
      contractsState,
      state,
      live,
      liveState,
      draftLive,
      busy,
      vor,
      nowMs,
      refresh,
      player,
      teamName,
      hasDynasty,
      mode,
      chooseMode,
    }),
    [config, teams, leagueName, limits, defaultTeamId, teamId, chooseTeam, plan, bundle, bundleState, contractsState, state, live, liveState, draftLive, busy, vor, nowMs, refresh, player, teamName, hasDynasty, mode, chooseMode],
  );
  // Tab links keep a non-default team and dynasty mode (from state: the URL
  // writes above are invisible to useSearchParams).
  const tabSearch = dynastyModeSearch(teamSearch("", teamId, defaultTeamId), mode);

  return (
    <FantraxLeagueContext.Provider value={value}>
      <TabSearchContext.Provider value={tabSearch}>
        <SnakeVerdictsProvider kind="fx" seed={snakeSeed}>
          <Suspense fallback={null}>
            <LeagueFromUrl onTeam={onUrlTeam} onMode={onUrlMode} />
          </Suspense>
          {draftRunning ? <DraftTurnWatcher /> : null}
          {children}
        </SnakeVerdictsProvider>
      </TabSearchContext.Provider>
    </FantraxLeagueContext.Provider>
  );
}

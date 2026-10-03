"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { TabSearchContext } from "@/components/league-shell/tab-search";
// The store only (not the chips): the tabs' chunks carry the chips and Snake's copy.
import { SnakeVerdictsProvider } from "@/components/snake/SnakeVerdictsContext";
import { bestFpg, buildDailyPlan, indexSchedule, lineupTarget, seasonFp, type DailyPlan } from "@/lib/fantrax/daily-plan";
import { needsLeagueModel, needsLeaguePack, type LeagueModel, type LeaguePack } from "@/lib/fantrax/league-pack";
import { targetRosterPeriod } from "@/lib/fantrax/dates";
import {
  draftPollMs,
  fetchLiveOverlay,
  LIVE_DRAFT_POLL_MS,
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
  /**
   * What only this league needs (`league-pack.ts`): its words and pieces.
   * Given by the league's own shell chunk (`CapLeagueShell`); none for a
   * league whose config needs none (Captains).
   */
  pack?: LeaguePack | null;
  /**
   * Its models (points over replacement, the planner's own rules), a chunk its
   * shell fetches as the page starts: until it is in, the page keeps the baked
   * plan, so the board never flashes another order (`modelState` "error":
   * the live read falls back to the period's first puck drop).
   */
  model?: LeagueModel | null;
  modelState?: LoadState;
  /**
   * A salary-cap league's contracts, read by its shell: their own read, so
   * neither the plan nor the live picks wait for them, and a failure is said
   * as such (`contractsState`). None elsewhere.
   */
  contracts?: ContractsFile | null;
  contractsState?: LoadState;
  /** « Actualiser » after a failed contracts or model read: the shell reads them again. */
  retryExtras?: () => void;
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
  pack = null,
  model = null,
  modelState = "ready",
  contracts = null,
  contractsState = "ready",
  retryExtras,
  children,
}: FantraxLeagueProviderProps) {
  const config = useMemo(() => {
    const cfg = fantraxLeague(slug);
    // A league whose rules or words live in a pack never runs without it (the
    // prerender fails loudly instead of showing another league's wording).
    if (!pack && needsLeaguePack(cfg)) throw new Error(`${slug}: render its tabs inside CapLeagueShell (league pack missing)`);
    return cfg;
  }, [slug, pack]);
  const [teamId, setTeamId] = useState(defaultTeamId);
  const [mode, setMode] = useState<DynastyMode>(DEFAULT_DYNASTY_MODE);
  const [nowMs, setNowMs] = useState<number | null>(null);
  const [planNowMs, setPlanNowMs] = useState<number | null>(null);
  const [baseBundle, setBundle] = useState<LeagueSnapshotBundle | null>(null);
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

  const bundle = useMemo(() => (baseBundle ? { ...baseBundle, contracts } : null), [baseBundle, contracts]);

  // ---- rosters and picks: the snapshot's, the live read over them
  const state = useMemo(() => (baseBundle ? withLiveOverlay(baseBundle.state, live) : null), [baseBundle, live]);

  /**
   * Points over replacement for the whole projected pool, from the LEAGUE's
   * depth: the replacement level is a property of its starting seats, so it is
   * built from the snapshot and never moves with the live picks (`state` is
   * deliberately not a dependency). The model (`points-vor.ts` and its seat
   * fill, with the planner's own rules: `cap-league-model.ts`) is its own
   * chunk, fetched by the league's shell: Captains, whose captain slot it
   * cannot rank, never loads it. Until it is in, the page keeps the baked plan
   * (`modelReady`), so the board never flashes another order.
   */
  const modelReady = !needsLeagueModel(config) || !!model;
  // A league's own planner rules (salary cap, per-game locks) come with its model.
  const kit = model?.kit ?? null;

  const vor = useMemo(
    () =>
      baseBundle && model && canRankByPoints(config)
        ? model.leagueVor(
            config,
            baseBundle.values.players,
            (id) => seasonFp(baseBundle.values.players[id]!, config),
            baseBundle.league.slotCounts,
          )
        : null,
    [baseBundle, model, config],
  );

  // ---- plan (browser re-run once the snapshot is in; baked plan until then)
  // A salary-cap league's roster fit is left out of it (`deferCapFit`): it
  // costs about the plan again and depends on the roster, not the clock.
  const deferFit = !!config.salaryCap;
  const computed = useMemo(() => {
    if (!bundle || !state || planNowMs === null || !modelReady) return null;
    return buildDailyPlan({ ...bundle, state, teamId, nowMs: planNowMs, config, vor, contracts: bundle.contracts, kit, deferCapFit: deferFit });
  }, [bundle, state, teamId, planNowMs, config, vor, modelReady, kit, deferFit]);

  // ---- salary-cap fit: once per team, roster (statuses, icons) and lineup
  // period, just after the plan is on screen; the per-game lock re-plans and
  // the live reads that change nothing it reads reuse it. Until it is in, the
  // baked one for the same team and period (no flash of the line).
  const fitFrom = computed?.target?.rosterPeriod;
  const fitKey =
    deferFit && state && fitFrom !== undefined
      ? JSON.stringify([teamId, fitFrom, (state.rosters[teamId] ?? []).map((r) => [r.id, r.status, state.icons[r.id]])])
      : null;
  const [fit, setFit] = useState<{ key: string; b: unknown; v: DailyPlan["capFit"] }>();
  const fitState = useRef(state);
  useEffect(() => {
    fitState.current = state;
  });
  useEffect(() => {
    const st = fitState.current;
    const fitNow = kit?.planCapFit;
    if (!fitKey || !bundle || !fitNow || !st || fitFrom === undefined) return;
    const h = window.setTimeout(
      () => setFit({ key: fitKey, b: bundle, v: fitNow({ ...bundle, state: st, teamId, nowMs: 0, config, contracts: bundle.contracts, kit }, fitFrom) }),
      50,
    );
    return () => window.clearTimeout(h);
  }, [fitKey, bundle, kit, config, teamId, fitFrom]);
  const plan = useMemo(
    () =>
      !computed
        ? teamId === initialPlan.teamId
          ? initialPlan
          : null
        : deferFit
          ? {
              ...computed,
              capFit:
                fit?.key === fitKey && fit.b === bundle
                  ? fit.v
                  : teamId === initialPlan.teamId && initialPlan.target?.rosterPeriod === fitFrom
                    ? initialPlan.capFit
                    : undefined,
            }
          : computed,
    [computed, teamId, initialPlan, deferFit, fit, fitKey, bundle, fitFrom],
  );
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
    // A per-game-lock league waits for its model (fetched alongside the
    // snapshot); if the model cannot load, the next period by its first puck
    // drop, so the live picks keep coming.
    const gameLock = config.cadence.lock?.kind === "game";
    if (gameLock && !kit && modelState !== "error") return null;
    const target =
      gameLock && !kit
        ? targetRosterPeriod(periods, planNowMs)
        : lineupTarget(periods, indexSchedule(baseBundle.schedule, periods), planNowMs, config, kit);
    return (target ?? periods[periods.length - 1])?.number ?? null;
  }, [baseBundle, planNowMs, config, kit, modelState]);

  // The last live read, for the next one: a read whose draft half fails keeps
  // this draft (never the baked one). Refs, not state: the reads run from
  // timers and must not restart when it changes.
  const liveRef = useRef<LiveOverlay | null>(null);
  const liveInFlight = useRef(false);
  /** The read in flight (settles, never rejects): a new read starts after it. */
  const liveRead = useRef<Promise<void> | null>(null);
  useEffect(() => {
    liveRef.current = live;
  }, [live]);

  useEffect(() => {
    if (livePeriod === null) return;
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      liveInFlight.current = true;
      liveRead.current = fetchLiveOverlay(livePeriod, { force: refreshCount > 0, config, prev: liveRef.current })
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
    };
    // « Actualiser » during a poll: wait for that read instead of a second one
    // alongside it (one read at a time; the throttle spaces the calls anyway).
    if (liveInFlight.current && liveRead.current) void liveRead.current.then(run);
    else run();
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
      liveRead.current = fetchLiveOverlay(livePeriod, { force: true, config, prev: liveRef.current })
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
    if (contractsState === "error" || modelState === "error") retryExtras?.();
    setRefreshCount((n) => n + 1);
  }, [bundleState, contractsState, modelState, retryExtras]);

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
      pack,
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
    [config, pack, teams, leagueName, limits, defaultTeamId, teamId, chooseTeam, plan, bundle, bundleState, contractsState, state, live, liveState, draftLive, busy, vor, nowMs, refresh, player, teamName, hasDynasty, mode, chooseMode],
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

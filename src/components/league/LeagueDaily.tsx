"use client";

import { RefreshCw, Snowflake } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
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
import { fmtDateTime, fmtTime } from "@/lib/fantrax/league-copy";
import { withLiveOverlay, type LiveOverlay } from "@/lib/fantrax/live";
import { CapMeter } from "./CapMeter";
import { DraftPanel } from "./DraftPanel";
import { GoalieStarts } from "./GoalieStarts";
import type { PlayerLookup } from "./LeagueCard";
import { LineupCard } from "./LineupCard";
import { RosterAlerts } from "./RosterAlerts";
import { WaiverTargets } from "./WaiverTargets";
import { WeekGrid } from "./WeekGrid";

type LoadState = "loading" | "ready" | "error";

interface LeagueDailyProps {
  /** Default team's plan baked at sync time (first paint, no JS needed). */
  initialPlan: DailyPlan;
  /** Sorted on the server so the options hydrate identically. */
  teams: Array<{ id: string; name: string }>;
  leagueName: string;
  defaultTeamId: string;
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
 * The /league daily view. First paint is the default team's baked plan;
 * after mount the page loads the snapshot, reads rosters and draft picks
 * live from Fantrax, and re-runs the same pure planner in the browser for
 * whichever team is picked, at the current time. "Now" only exists in
 * effects (React purity), so the prerendered HTML carries no countdowns.
 */
export function LeagueDaily({ initialPlan, teams, leagueName, defaultTeamId }: LeagueDailyProps) {
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
  const onUrlTeam = useCallback(
    (fromUrl: string | null) => {
      setTeamId(pickTeam([fromUrl, readStoredTeam()], teams, defaultTeamId));
    },
    [teams, defaultTeamId],
  );

  const chooseTeam = (next: string) => {
    setTeamId(next);
    storeTeam(next);
    try {
      // Native History API, as useRankingsUrlSync does: Next's patched
      // replaceState soft-navigates, which scrolls to top on static export.
      const url = `${window.location.pathname}${teamSearch(window.location.search, next, defaultTeamId)}`;
      History.prototype.replaceState.call(window.history, window.history.state, "", url);
    } catch {
      // Sandboxed frames can refuse history writes; the choice still applies.
    }
  };

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

  // ---- plan (browser re-run once the snapshot is in; baked plan until then)
  const computed = useMemo(() => {
    if (!bundle || planNowMs === null) return null;
    return buildDailyPlan({
      ...bundle,
      state: withLiveOverlay(bundle.state, live),
      teamId,
      nowMs: planNowMs,
    });
  }, [bundle, live, teamId, planNowMs]);
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

  // The page is French but the shared root layout declares English; switch
  // the document language while this view is mounted (the page also sets it
  // before first paint) and put it back on the way out (client navigation).
  useEffect(() => {
    const root = document.documentElement;
    const prev = root.lang;
    root.lang = "fr-CA";
    return () => {
      root.lang = prev && prev !== "fr-CA" ? prev : "en";
    };
  }, []);

  const refresh = () => {
    setLiveState("loading");
    setPlanNowMs(Date.now());
    if (bundleState === "error") {
      setBundleState("loading");
      setBundleAttempt((n) => n + 1);
    }
    setRefreshCount((n) => n + 1);
  };

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

  const sections = [
    { id: "alertes", label: "Légalité" },
    { id: "alignement", label: "Alignement" },
    { id: "gardiens", label: "Gardiens" },
    { id: "plafonds", label: "Plafonds" },
    ...(plan?.draft ? [{ id: "repechage", label: "Repêchage" }] : []),
    { id: "ballottage", label: "Ballottage" },
    { id: "calendrier", label: "Calendrier" },
  ];

  return (
    <>
      <Suspense fallback={null}>
        <TeamFromUrl onTeam={onUrlTeam} />
      </Suspense>

      <header className="relative border-b border-white/10 bg-slate-950/80 pt-[env(safe-area-inset-top,0px)]">
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(56,189,248,0.15),_transparent_55%)]" />
        </div>
        <div className="relative mx-auto flex max-w-6xl flex-col gap-5 px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3 text-cyan-400">
            <Snowflake className="h-5 w-5 shrink-0" aria-hidden="true" />
            <span className="text-sm font-medium uppercase tracking-[0.2em]">Fantrax · {leagueName}</span>
          </div>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <h1 className="break-words text-3xl font-bold tracking-tight text-white sm:text-4xl">
                {teamName(teamId)}
              </h1>
              <p className="mt-2 max-w-2xl text-base text-slate-400">
                {
                  "Aide quotidienne : légalité de l'alignement, capitaine, gardiens, plafonds de matchs, ballottage et repêchage."
                }
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-wider text-slate-400">
                Équipe
                <select
                  value={teamId}
                  onChange={(e) => chooseTeam(e.target.value)}
                  className="min-h-11 w-full rounded-xl border border-white/15 bg-slate-900 px-3 text-sm normal-case tracking-normal text-white sm:w-64"
                >
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={refresh}
                aria-busy={busy}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-cyan-500/40 bg-cyan-500/10 px-4 text-sm font-semibold text-cyan-200 transition motion-reduce:transition-none hover:border-cyan-400/60 hover:bg-cyan-500/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
              >
                <RefreshCw
                  className={`h-4 w-4 ${busy ? "animate-spin motion-reduce:animate-none" : ""}`}
                  aria-hidden="true"
                />
                Actualiser
              </button>
            </div>
          </div>

          {/* Only the status words are live: the read times sit outside the
              region, so the 90 s draft polling never re-announces them. */}
          <p className="text-sm text-slate-400">
            {plan ? (
              <>
                Données synchronisées : <time dateTime={plan.dataAsOf}>{fmtDateTime(plan.dataAsOf)}</time>
                <span className="mx-2 text-slate-700">·</span>
              </>
            ) : null}
            <span aria-live="polite">
              {bundleState === "error" ? (
                <span className="text-amber-200">
                  {"Données détaillées indisponibles : plan de la dernière synchronisation (Actualiser pour réessayer)."}
                </span>
              ) : liveState === "ready" && live ? (
                <span className="text-cyan-300">Effectifs et repêchage en direct de Fantrax</span>
              ) : liveState === "error" ? (
                <span className="text-amber-200">
                  {live
                    ? "Fantrax injoignable : effectifs de la dernière lecture en direct"
                    : "Fantrax injoignable : effectifs de la dernière synchronisation."}
                </span>
              ) : (
                <span>Lecture des effectifs en direct…</span>
              )}
            </span>
            {bundleState !== "error" && live && (liveState === "ready" || liveState === "error") ? (
              <span className={liveState === "ready" ? "text-cyan-300" : "text-amber-200"}>
                {liveState === "ready" ? " : " : ", "}
                <time dateTime={live.fetchedAt}>{fmtTime(live.fetchedAt)}</time>
                {liveState === "error" ? "." : null}
              </span>
            ) : null}
          </p>
          <p className="text-xs text-slate-500">
            {
              "Outil non officiel, en lecture seule : il ne se connecte jamais à votre compte et ne modifie jamais votre équipe. Faites les changements vous-même dans Fantrax."
            }
          </p>

          <nav aria-label="Sections de la page">
            <ul className="flex flex-wrap gap-2">
              {sections.map((s) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    className="inline-flex min-h-11 items-center rounded-full border border-white/10 bg-white/5 px-3 text-sm text-slate-300 transition motion-reduce:transition-none hover:border-cyan-400/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                  >
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        {plan ? (
          <>
            <RosterAlerts plan={plan} player={player} />
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
              <LineupCard plan={plan} player={player} nowMs={nowMs} />
              <div className="min-w-0 space-y-6">
                <GoalieStarts plan={plan} player={player} />
                <CapMeter plan={plan} />
              </div>
            </div>
            <DraftPanel
              plan={plan}
              player={player}
              teamName={teamName}
              recent={live?.recent ?? null}
              liveAt={live?.fetchedAt ?? null}
              nowMs={nowMs}
            />
            <WaiverTargets plan={plan} player={player} />
            <WeekGrid plan={plan} player={player} />
          </>
        ) : bundleState === "error" ? (
          <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-6 text-sm text-rose-100">
            <p>{"Impossible de charger les données de la ligue pour cette équipe."}</p>
            <button
              type="button"
              onClick={refresh}
              className="mt-3 inline-flex min-h-11 items-center rounded-xl border border-rose-300/40 px-4 font-semibold text-rose-50 hover:bg-rose-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
            >
              Réessayer
            </button>
          </div>
        ) : (
          <p role="status" className="py-12 text-center text-sm text-slate-400">
            {"Chargement de l'équipe…"}
          </p>
        )}
      </div>
    </>
  );
}

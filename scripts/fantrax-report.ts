/**
 * Daily Fantrax report in the terminal — the fallback for the /league page.
 * Reads the snapshot written by `npm run league:sync`; `--live` first
 * re-reads rosters and draft picks from fxea (public API, no login).
 *
 * Run: npm run league:report -- --team <teamId> [--live] [--now <ISO>]
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { FxeaDraftResults, FxeaTeamRosters } from "../src/lib/fantrax/api-types";
import { fxeaGet } from "../src/lib/fantrax/client";
import {
  CLAIMS_PER_WEEK,
  FANTRAX_DEFAULT_TEAM_ID,
  FANTRAX_LEAGUE_ID,
  LEAGUE_TIME_ZONE,
  SYNC_USER_AGENT,
} from "../src/lib/fantrax/config";
import { buildDailyPlan, type DailyPlan, type PlanAlert, type PlanLineup, type TeamGame } from "../src/lib/fantrax/daily-plan";
import { liveOverlay, withLiveOverlay } from "../src/lib/fantrax/live";
import { deadReason } from "../src/lib/fantrax/roster-rules";
import type {
  LeagueSnapshot,
  ScheduleSnapshot,
  StateSnapshot,
  ValuesSnapshot,
} from "../src/lib/fantrax/snapshot-types";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const argValue = (flag: string) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

function load<T>(...parts: string[]): T {
  const path = join(ROOT, ...parts);
  if (!existsSync(path)) {
    console.error(`FAIL: ${parts.join("/")} missing — run npm run league:sync first`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

const et = (iso: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: LEAGUE_TIME_ZONE, ...opts }).format(new Date(iso));
const etDateTime = (iso: string) =>
  et(iso, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZoneName: "short" });
const etTime = (iso: string) => et(iso, { hour: "2-digit", minute: "2-digit", hour12: false });
const pad = (s: string | number, n: number) => String(s).padEnd(n);
const lpad = (s: string | number, n: number) => String(s).padStart(n);
const fx = (x: number, d = 2) => x.toFixed(d);
/** `2026-10-11` → `Oct 11` (calendar date, no time zone involved). */
const calDay = (date: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", month: "short", day: "numeric" }).format(new Date(`${date}T12:00:00Z`));
const statusWord = (s: string | undefined) =>
  ({ ACTIVE: "Active", RESERVE: "Reserve", MINORS: "Minors", INJURED_RESERVE: "IR" })[s ?? ""] ?? s ?? "?";

function until(iso: string, nowMs: number): string {
  const mins = Math.round((Date.parse(iso) - nowMs) / 60_000);
  if (mins <= 0) return "locked";
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  return d > 0 ? `in ${d}d ${h}h` : `in ${h}h ${m}m`;
}

function main() {
  const teamId = argValue("--team") ?? FANTRAX_DEFAULT_TEAM_ID;
  const nowArg = argValue("--now");
  const nowMs = nowArg ? Date.parse(nowArg) : Date.now();
  if (!Number.isFinite(nowMs)) throw new Error(`bad --now ${nowArg}`);

  const league = load<LeagueSnapshot>("src", "data", "fantrax", "league.json");
  const state = load<StateSnapshot>("public", "fantrax", "state.json");
  const values = load<ValuesSnapshot>("public", "fantrax", "values.json");
  const schedule = load<ScheduleSnapshot>("public", "fantrax", "schedule-20262027.json");
  if (!league.teams.some((t) => t.id === teamId)) {
    throw new Error(`team ${teamId} is not in ${league.leagueName}`);
  }
  return { teamId, nowMs, league, state, values, schedule };
}

async function refreshLive(input: ReturnType<typeof main>) {
  const req = { userAgent: SYNC_USER_AGENT };
  const target = input.league.rosterPeriods.find((p) => Date.parse(p.start) > input.nowMs);
  const rosters = await fxeaGet<FxeaTeamRosters>(
    "getTeamRosters",
    { leagueId: FANTRAX_LEAGUE_ID, period: target?.number ?? input.state.rosterPeriod },
    req,
  );
  const draft = await fxeaGet<FxeaDraftResults>("getDraftResults", { leagueId: FANTRAX_LEAGUE_ID }, req);
  const period = target?.number ?? input.state.rosterPeriod;
  input.state = withLiveOverlay(input.state, liveOverlay(rosters, draft, Date.now(), period));
}

function print(plan: DailyPlan, input: ReturnType<typeof main>) {
  const P = plan.players;
  const name = (id: string | null | undefined) => (id ? (P[id]?.n ?? input.values.players[id]?.n ?? id) : "—");
  const team = (id: string | null | undefined) => (id ? (P[id]?.t ?? "") : "");
  const teamName = (id: string) => input.league.teams.find((t) => t.id === id)?.name ?? id;
  const game = (g: TeamGame | null) => (g ? `${g.home ? "vs" : "@ "} ${g.opp} ${etTime(g.startUTC)}` : "no game");
  const out: string[] = [];
  const h = (title: string) => out.push("", `== ${title} ==`);

  out.push(`${input.league.leagueName} — ${plan.teamName} (${plan.teamId})`);
  out.push(
    `Data synced ${etDateTime(plan.dataAsOf)} · fxpa ${plan.fxpaOk ? "ok" : "DOWN (no caps/injury flags)"} · projections ${input.values.projectionsAt.slice(0, 10)}`,
  );
  if (plan.target) {
    out.push(`Next lineup lock: lineup period ${plan.target.rosterPeriod}, ${etDateTime(plan.target.start)} (${until(plan.target.start, input.nowMs)})`);
  }
  if (plan.scoringPeriod) {
    const sp = plan.scoringPeriod;
    out.push(
      `Scoring period ${sp.number}: ${calDay(sp.firstDay)} → ${calDay(sp.lastDay)} · ${sp.daysLeft} lineup days left · caps GP ${sp.gpMax ?? "?"} / GS ${sp.gsMax ?? "?"}`,
    );
  }

  // ---- legality
  h("Roster legality");
  const L = plan.legality;
  const c = L.counts;
  out.push(
    `${L.illegal ? "ILLEGAL" : "Legal"}: ${c.counted}/${L.minTotal} counted (Active ${c.active} + Reserve ${c.reserve}; IR ${c.ir} and Minors ${c.minors} don't count)${L.need ? ` — need ${L.need} more or the team scores 0` : ""}`,
  );
  if (L.fixes.length || L.reserveFills.length) {
    out.push("Moves to reach the minimum (leaving Minors is never blocked; no draft pick or claim needed):");
    for (const id of L.fixes) {
      out.push(
        `  ${pad(name(id), 22)} ${pad(team(id), 4)} ${pad(P[id]?.e ?? "", 10)} ${pad(`${statusWord(P[id]?.st)} → ${statusWord(L.fixTo[id])}`, 18)} ${fx(P[id]?.fpg ?? 0)} FP/G`,
      );
    }
    const bodyWhy = (id: string) => {
      const why = P[id] ? deadReason({ icons: P[id]!.icons, team: P[id]!.t }) : null;
      return why ? `, won't score (${why})` : "";
    };
    for (const id of L.reserveFills) {
      out.push(
        `  ${pad(name(id), 22)} ${pad(team(id), 4)} ${pad(P[id]?.e ?? "", 10)} ${pad(`${statusWord(P[id]?.st)} → Reserve`, 18)} counts toward the minimum${bodyWhy(id)}`,
      );
    }
  }
  if (L.shortBy) out.push(`Still ${L.shortBy} short after every Minors/IR move: claim or draft players.`);
  const others = L.movableFromMinors.filter((id) => !L.fixes.includes(id) && !L.reserveFills.includes(id));
  if (others.length) out.push(`Other playable Minors: ${others.map((id) => `${name(id)} (${fx(P[id]?.fpg ?? 0)})`).join(", ")}`);
  for (const a of plan.alerts) {
    const line = alertLine(a, name);
    if (line) out.push(line);
  }

  // ---- tonight
  if (plan.lineup && plan.target) {
    h(`Next lineup: period ${plan.target.rosterPeriod} (${et(plan.target.start, { weekday: "short", month: "short", day: "numeric" })}) — optimal`);
    printLineup(out, plan.lineup, name, team, game);
  }

  // ---- per-game lineup
  h("Per-game lineup (who belongs in the active slots, schedule ignored)");
  printLineup(out, plan.baseLineup, name, team, null);
  out.push(
    `Captain choices (per-game lineup total with each as Skt ×${fx(input.league.sktMultiplier, 1)}): ${plan.captains.map((x) => `${name(x.id)} ${fx(x.total)}${x.delta < 0 ? ` (${fx(x.delta)})` : ""}`).join(", ")}`,
  );
  if (plan.currentCaptain) {
    const best = plan.captains[0];
    const cur = plan.currentCaptain;
    out.push(
      `Current captain: ${name(cur.id)}${best && best.id !== cur.id && cur.delta < 0 ? ` → making ${name(best.id)} captain (and re-slotting the rest) adds +${fx(-cur.delta)} FP per game to the per-game lineup` : " (already the best choice)"}`,
    );
  }

  // ---- goalies
  h(`Goalies (${plan.target ? `period ${plan.target.rosterPeriod}` : "per game"})`);
  if (!plan.goalies.length) out.push("No playable goalie on the roster.");
  for (const g of plan.goalies) {
    out.push(
      `  ${pad(name(g.id), 22)} ${pad(team(g.id), 4)} ${pad(game(g.game), 16)} P(start) ${fx(g.pStart)} × ${fx(g.perStart)} = ${fx(g.value)} xFP${g.b2b ? "  (2nd night of back-to-back)" : ""}`,
    );
  }

  // ---- cap
  if (plan.cap) {
    const k = plan.cap;
    h(`Games cap (scoring period ${plan.scoringPeriod?.number})`);
    out.push(
      `Skater GP ${k.gp}/${k.gpMax ?? "?"} (projected ${k.projectedGp} by period end) · Goalie GS ${k.gs}/${k.gsMax ?? "?"} (projected ${k.projectedGs})${k.known ? "" : " · usage unknown (fxpa down)"}`,
    );
    out.push(
      k.gpBinds || k.gsBinds
        ? "WARNING: projected to reach a cap before the last day — once a cap is reached at the start of a day, the whole team stops scoring for the rest of the period."
        : "Caps will not bind at this pace (crossing one on the last day costs nothing).",
    );
  }

  // ---- week grid
  if (plan.week) {
    h("Games left this scoring period");
    const days = plan.week.days.map((d) => et(`${d}T16:00:00Z`, { weekday: "short" }).slice(0, 2));
    out.push(`  ${pad("Player", 22)} ${pad("Tm", 4)} ${days.map((d) => pad(d, 3)).join("")} Tot`);
    const rows = [...plan.week.rows].sort((a, b) => b.total - a.total);
    const dead = new Set(plan.legality.dead.map((x) => x.id));
    for (const r of rows) {
      const st = dead.has(r.id)
        ? " (can't score)"
        : P[r.id]?.st === "ACTIVE"
          ? ""
          : ` (${(P[r.id]?.st ?? "").toLowerCase()})`;
      out.push(`  ${pad(name(r.id), 22)} ${pad(team(r.id), 4)} ${r.games.map((g) => pad(g ? "x" : ".", 3)).join("")} ${lpad(r.total, 3)}${st}`);
    }
  }

  // ---- waivers
  h(`Waiver / FA targets (rest of scoring period ${plan.scoringPeriod?.number ?? "?"})`);
  const w = plan.waivers;
  out.push(
    `Claims this week (since ${w.weekStart}): ${w.claimsUsed ?? "?"}/${CLAIMS_PER_WEEK} used${w.claimsLeft != null ? `, ${w.claimsLeft} left` : ""} · showing gains >= 3 FP, best 3 per position`,
  );
  if (!w.targets.length) out.push("No pickup adds 3+ FP this period.");
  for (const t of w.targets) {
    const drop = t.drop ? ` · ${t.drop.action === "minors" ? "send to Minors" : "drop"} ${name(t.drop.id)}` : " · no drop needed";
    out.push(
      `  ${pad(name(t.id), 22)} ${pad(team(t.id), 4)} ${pad(P[t.id]?.e ?? "", 10)} ${t.status}  +${fx(t.delta, 1)} FP over ${t.days} games (${fx(t.fpg)} FP/G)${drop}`,
    );
  }

  // ---- draft
  if (plan.draft) {
    const d = plan.draft;
    h(`Draft (${d.state}: ${d.made}/${d.total} picks made)`);
    if (d.current) out.push(`On the clock: #${d.current.pick} (R${d.current.round}) ${teamName(d.current.teamId)}`);
    if (d.next) {
      out.push(
        `Your next pick: #${d.next.pick} (R${d.next.round})${d.picksBefore > 0 ? `, ${d.picksBefore} picks away` : " — YOU ARE ON THE CLOCK"}${d.following ? `; then #${d.following.pick}` : ""} · remaining ${d.remaining.map((p) => `#${p}`).join(" ")}`,
      );
      out.push(
        `VONA by position (value now − expected at #${d.following?.pick ?? "?"}): ${(["C", "W", "D", "G"] as const).map((g) => `${g} ${d.vona[g].vona == null ? "n/a" : fx(d.vona[g].vona!, 1)} (${name(d.vona[g].bestId)})`).join(" · ")}`,
      );
    } else out.push("You have no picks left.");
    out.push(`  ${pad("Best available", 24)} ${pad("Tm", 4)} ${pad("Pos", 10)} ${lpad("SeasonFP", 8)} ${lpad("Value", 6)} ${lpad("VONA", 5)}  Age Ros%`);
    for (const b of d.board) {
      out.push(
        `  ${pad(name(b.id), 24)} ${pad(team(b.id), 4)} ${pad(P[b.id]?.e ?? "", 10)} ${lpad(fx(b.seasonFp, 0), 8)} ${lpad(fx(b.value, 0), 6)} ${lpad(b.vona == null ? "-" : fx(b.vona, 1), 5)}  ${lpad(P[b.id]?.age ?? "?", 3)} ${lpad(P[b.id]?.ros ?? "?", 4)}${b.likelyGone ? "  (likely gone by your pick)" : ""}`,
      );
    }
    out.push(
      "Value = season FP + up to 50% when your D/G slots are empty. VONA ignores prospects (no projection); the ADP simulation removes only the share of picks spent on projected players so far.",
    );
  }

  console.log(out.join("\n"));
}

function alertLine(a: PlanAlert, name: (id: string | null | undefined) => string): string | null {
  const tag = a.level === "error" ? "!!" : a.level === "warn" ? " !" : "  ";
  switch (a.code) {
    case "illegal-roster":
      return null; // printed in the legality header
    case "dead-active": {
      const advice =
        a.to === "RESERVE"
          ? " — move him to Reserve (he still counts toward the minimum)"
          : a.to === "MINORS"
            ? " — send him to Minors"
            : a.to === "INJURED_RESERVE"
              ? " — move him to IR"
              : " — replace him";
      return `${tag} ${name(a.ids?.[0])} sits in an active ${a.slot} slot but cannot score (${a.detail})${advice}`;
    }
    case "empty-slot":
      return `${tag} ${a.count} empty ${a.slot} slot${(a.count ?? 0) > 1 ? "s" : ""}`;
    case "healthy-ir":
      return `${tag} Healthy on IR (illegal after 2 lineup periods): ${(a.ids ?? []).map((id) => name(id)).join(", ")}`;
    case "roster-limit":
      return `${tag} Roster limit broken: ${a.detail} ${a.count}/${a.limit}${a.slot ? ` (${a.slot})` : ""}`;
    case "over-max-after-moves":
      return `${tag} Suggested moves put Active+Reserve at ${a.count} (max ${a.limit}) — send someone to Minors or drop`;
    case "fxpa-down":
      return `${tag} fxpa unavailable (${a.detail ?? "?"}): no caps, injury or Minors flags`;
    case "stale-data":
      return `${tag} Snapshot is ${a.count} h old — run npm run league:sync`;
    default:
      return `${tag} ${a.code}`;
  }
}

function printLineup(
  out: string[],
  l: PlanLineup,
  name: (id: string | null | undefined) => string,
  team: (id: string | null | undefined) => string,
  game: ((g: TeamGame | null) => string) | null,
) {
  for (const s of l.slots) {
    const cap = s.slot === "Skt" && l.captain && s.id === l.captain.id ? `  captain, +${fx(l.captain.gain)} over his best other slot` : "";
    out.push(
      `  ${pad(s.slot, 4)} ${pad(name(s.id), 22)} ${pad(team(s.id), 4)} ${game ? pad(s.id ? game(s.game) : "", 16) : ""}${lpad(fx(s.value), 6)}${cap}`,
    );
  }
  out.push(`  Total ${fx(l.total)} expected FP`);
  if (l.moves.length) {
    out.push(`  Moves: ${l.moves.map((m) => `${name(m.id)} ${m.from} → ${m.to}`).join("; ")}`);
  } else out.push("  No moves needed.");
}

(async () => {
  const input = main();
  if (args.includes("--live")) await refreshLive(input);
  const plan = buildDailyPlan(input);
  print(plan, input);
})().catch((e) => {
  console.error(`FAIL: league:report — ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});

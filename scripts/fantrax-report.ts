/**
 * Daily Fantrax report in the terminal — the fallback for the league page.
 * Reads the snapshot written by `npm run league:sync`; `--live` first
 * re-reads rosters and draft picks from fxea (public API, no login).
 *
 * Run: npm run league:report -- [--league <slug>] --team <teamId> [--live]
 *        [--now <ISO>] [--dynasty winNow|balanced|longTerm] [--no-dynasty]
 *      npm run league:report -- [--league <slug>] --priors
 *      npm run league:report -- [--league <slug>] --vor
 * Default league: Captains Dynasty. The dynasty section reads that league's
 * dynasty.json (npm run dynasty:build) and only exists for a league whose
 * config enables the keeper model.
 *
 * `--vor` prints nothing else: the replacement levels the board is ranked by
 * (`src/lib/fantrax/points-vor.ts`), the untaken-pool reading beside them and
 * the weakest starter of each seat, so the "last starter, not best free agent"
 * choice can be audited instead of trusted.
 *
 * `--priors` prints nothing else: it re-measures the league's own fallback
 * values (`FantraxPriors` in `src/lib/fantrax/config.ts`) from the committed
 * snapshot, so the numbers in the config can be checked rather than trusted.
 * They are POINTS in that league's scoring, so they can never be shared
 * between leagues.
 */
import { existsSync, readFileSync } from "fs";
import type { FxeaDraftResults, FxeaTeamRosters } from "../src/lib/fantrax/api-types";
import { fxeaGet } from "../src/lib/fantrax/client";
import { SYNC_USER_AGENT } from "../src/lib/fantrax/config";
import { fantraxLeagueArg, fantraxPaths } from "./fantrax-paths";
import { buildDailyPlan, type DailyPlan, type PlanAlert, type PlanLineup, type TeamGame } from "../src/lib/fantrax/daily-plan";
import { liveOverlay, withLiveOverlay } from "../src/lib/fantrax/live";
import { dynastyBoard, dynastyDropProtection } from "../src/lib/dynasty/board";
import { explainFr, KEEPER_FR, KEEPER_TEAM_FR, keeperView, MODE_FR, PHASE_FR, rosterHintFr } from "../src/lib/dynasty/explain";
import { MODES, type DynastySnapshot, type Mode } from "../src/lib/dynasty/types";
import { bestFpg, isGoalieRecord, seasonFp } from "../src/lib/fantrax/draft-inputs";
import { canRankByPoints, leagueVor, pointsVor, RESERVE_GOALIES_PER_TEAM, type VorPlayer } from "../src/lib/fantrax/points-vor";
import { isRuledOut } from "../src/lib/fantrax/points-model";
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
const CFG = fantraxLeagueArg(args, "league:report");
const PATHS = fantraxPaths(CFG, ROOT);

function load<T>(path: string): T {
  if (!existsSync(path)) {
    const label = path.slice(ROOT.length + 1).split(/[\\/]/).join("/");
    console.error(`FAIL: ${label} missing — run npm run league:sync -- --league ${CFG.slug} first`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

const et = (iso: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: CFG.timeZone, ...opts }).format(new Date(iso));
const etDateTime = (iso: string) =>
  et(iso, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZoneName: "short" });
const etTime = (iso: string) => et(iso, { hour: "2-digit", minute: "2-digit", hour12: false });
const pad = (s: string | number, n: number) => String(s).padEnd(n);
const lpad = (s: string | number, n: number) => String(s).padStart(n);
const fx = (x: number, d = 2) => x.toFixed(d);
const signed = (x: number, d = 2) => `${x >= 0 ? "+" : ""}${x.toFixed(d)}`;
/** Odds as a percent that never rounds to a false certainty. */
const pct = (p: number) => (p > 0 && p < 1 && (p >= 0.995 || p < 0.005) ? (p < 0.5 ? "<1%" : ">99%") : `${Math.round(p * 100)}%`);
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

/**
 * `--priors`: the p25 FP/G of this league's PROJECTED regulars (>= 40 GP),
 * forwards and defencemen apart, and the expected points per start of the
 * goalie on the last starting seat once every team keeps a spare.
 *
 * Printed beside what the config holds, but only comparable when the config's
 * entry was measured the same way: Slapshot's was (it has no history — first
 * season), Captains' was measured on the REALIZED 2025-26 regulars instead, so
 * its two columns are expected to differ. The line under each says which.
 */
function reportPriors(): void {
  const values = load<ValuesSnapshot>(PATHS.values);
  const league = load<LeagueSnapshot>(PATHS.league);
  const proj = Object.values(values.players).filter((r) => r.src === "proj");
  const q25 = (xs: number[]) => {
    const sorted = [...xs].sort((a, b) => a - b);
    return sorted.length ? sorted[Math.max(0, Math.floor(0.25 * (sorted.length - 1)))]! : 0;
  };
  const dEligible = (e: string) => e.split(",").some((t) => CFG.eligibility.defenseTokens.includes(t.trim()));
  const fwd: number[] = [];
  const dee: number[] = [];
  for (const r of proj) {
    if (isGoalieRecord(r, CFG) || r.gp < 40) continue;
    (dEligible(r.e) ? dee : fwd).push(bestFpg(r, CFG));
  }
  const goalies = proj
    .filter((r) => isGoalieRecord(r, CFG))
    .map((r) => ({ e: r.gE ?? 0, fp: r.gp * (r.gE ?? 0), gp: r.gp, n: r.n }))
    .sort((a, b) => b.fp - a.fp);
  // The same rule as Captains' « 48th goalie »: teams x (starting G seats + 1).
  const seat = CFG.teams * ((league.slotCounts[CFG.eligibility.goalieToken as "G"] ?? 0) + 1);
  const marginal = goalies[seat - 1];
  const P = CFG.priors;
  const projected = CFG.slug === "slapshot";
  console.log(`priors — ${CFG.slug}, projections of ${values.projectionsAt}`);
  console.log(
    projected
      ? "  (config measured the same way: the two columns should match)"
      : "  (config measured on the REALIZED 2025-26 regulars: the two columns are NOT comparable)",
  );
  console.log(`  forwards  n=${fwd.length}  p25 FP/G ${fx(q25(fwd), 3)}   config fpg.F ${P.fpg.F}`);
  console.log(`  defence   n=${dee.length}  p25 FP/G ${fx(q25(dee), 3)}   config fpg.D ${P.fpg.D}`);
  console.log(
    `  goalie seat #${seat} of ${goalies.length} projected: ${marginal?.n ?? "—"}  E/start ${fx(marginal?.e ?? 0, 3)} (${marginal?.gp ?? 0} starts)   config goalieE ${P.goalieE}`,
  );
  console.log(`  regularMinFpg ${P.regularMinFpg} (same quantity as fpg.F)   pPlay ${P.pPlay}`);
}

/**
 * `--vor`: the three levels of the value model, per group and per seat.
 *
 * `replacement` is what VOR subtracts (the weakest STARTER of the group);
 * `untaken` is the other reading (the best player nobody holds), which is sane
 * for skaters and meaningless for goalies in a league with no free-agent market
 * left; `marginal starter` is the weakest player seated in each slot, which is
 * what proves the wings come out at the same depth. The reserve fill moves the
 * untaken column ONLY — the starting-seat levels are invariant to it, which the
 * last two lines show by re-running with no bench at all.
 */
function reportVor(): void {
  const values = load<ValuesSnapshot>(PATHS.values);
  const league = load<LeagueSnapshot>(PATHS.league);
  const pool: VorPlayer[] = Object.entries(values.players)
    .filter(([, r]) => r.src === "proj")
    .map(([id, r]) => ({ id, eligiblePos: r.e, seasonFp: seasonFp(r, CFG) }));
  console.log(`vor — ${CFG.slug}, projections of ${values.projectionsAt}, ${pool.length} projected players`);
  if (!canRankByPoints(CFG)) {
    console.log("  this league has a captain slot: one value per player is the wrong model, so no VOR is published");
    return;
  }
  const v = pointsVor(CFG, pool, { slotCounts: league.slotCounts });
  const bare = pointsVor(CFG, pool, { slotCounts: league.slotCounts, reservePerTeam: 0 });
  console.log(
    `  ${v.seats} starting seats, ${v.seated} filled; ${v.taken} players held (starters + ${CFG.limits.maxReserve} reserve a team, at most ${RESERVE_GOALIES_PER_TEAM} of them a goalie), ${v.untaken} untaken`,
  );
  console.log(`  ${pad("group", 6)} ${lpad("replacement", 12)} ${lpad("untaken", 9)} ${lpad("untaken(no bench)", 18)}`);
  for (const g of CFG.eligibility.groups) {
    console.log(
      `  ${pad(g, 6)} ${lpad(fx(v.replacement[g] ?? 0, 3), 12)} ${lpad(fx(v.rawReplacement[g] ?? 0, 3), 9)} ${lpad(fx(bare.rawReplacement[g] ?? 0, 3), 18)}`,
    );
  }
  const seats = Object.entries(v.marginalStarter).map(([slot, fp]) => `${slot} ${fx(fp ?? 0, 1)}`);
  console.log(`  marginal starter per seat: ${seats.join(" · ")}`);
  const same = CFG.eligibility.groups.every((g) => Math.abs((v.replacement[g] ?? 0) - (bare.replacement[g] ?? 0)) < 1e-9);
  console.log(
    same
      ? "  the replacement levels are identical with and without the bench: VOR reads them off the starting seats only"
      : "  WARNING: the bench moved a replacement level — it should not",
  );
}

function main() {
  const teamId = argValue("--team") ?? CFG.defaultTeamId;
  const nowArg = argValue("--now");
  const nowMs = nowArg ? Date.parse(nowArg) : Date.now();
  if (!Number.isFinite(nowMs)) throw new Error(`bad --now ${nowArg}`);

  const league = load<LeagueSnapshot>(PATHS.league);
  const state = load<StateSnapshot>(PATHS.state);
  const values = load<ValuesSnapshot>(PATHS.values);
  const schedule = load<ScheduleSnapshot>(PATHS.schedule);
  if (!league.teams.some((t) => t.id === teamId)) {
    throw new Error(`team ${teamId} is not in ${league.leagueName}`);
  }
  // Only a keeper-forever league has dynasty values at all.
  const dynasty =
    CFG.features.dynasty && !args.includes("--no-dynasty") && existsSync(PATHS.dynasty)
      ? (JSON.parse(readFileSync(PATHS.dynasty, "utf8")) as DynastySnapshot)
      : null;
  const modeArg = argValue("--dynasty") ?? "balanced";
  if (!MODES.includes(modeArg as Mode)) throw new Error(`bad --dynasty ${modeArg} (winNow | balanced | longTerm)`);
  return { teamId, nowMs, league, state, values, schedule, dynasty, dynastyMode: modeArg as Mode };
}

async function refreshLive(input: ReturnType<typeof main>) {
  const req = { userAgent: SYNC_USER_AGENT };
  const target = input.league.rosterPeriods.find((p) => Date.parse(p.start) > input.nowMs);
  const rosters = await fxeaGet<FxeaTeamRosters>(
    "getTeamRosters",
    { leagueId: CFG.leagueId, period: target?.number ?? input.state.rosterPeriod },
    req,
  );
  const draft = await fxeaGet<FxeaDraftResults>("getDraftResults", { leagueId: CFG.leagueId }, req);
  const period = target?.number ?? input.state.rosterPeriod;
  input.state = withLiveOverlay(input.state, liveOverlay(rosters, draft, Date.now(), period));
}

function print(plan: DailyPlan, input: ReturnType<typeof main>) {
  /** The board ranks by points over replacement here, not by season FP. */
  const vorLeague = canRankByPoints(CFG);
  const P = plan.players;
  const name = (id: string | null | undefined) => (id ? (P[id]?.n ?? input.values.players[id]?.n ?? id) : "—");
  const team = (id: string | null | undefined) => (id ? (P[id]?.t ?? "") : "");
  const teamName = (id: string) => input.league.teams.find((t) => t.id === id)?.name ?? id;
  const game = (g: TeamGame | null) => (g ? `${g.home ? "vs" : "@ "} ${g.opp} ${etTime(g.startUTC)}` : "no game");
  const out: string[] = [];
  const h = (title: string) => out.push("", `== ${title} ==`);

  out.push(`${input.league.leagueName} — ${plan.teamName} (${plan.teamId})`);
  out.push(
    // "DOWN" is a read that failed; a league whose config says fxpa is closed
    // is simply not a member's league, which is not a problem to chase.
    `Data synced ${etDateTime(plan.dataAsOf)} · fxpa ${
      plan.fxpaOk ? "ok" : CFG.features.fxpa ? "DOWN (no caps/injury flags)" : "closed for this league"
    } · projections ${input.values.projectionsAt.slice(0, 10)}`,
  );
  if (plan.target) {
    out.push(`Next lineup lock: lineup period ${plan.target.rosterPeriod}, ${etDateTime(plan.target.start)} (${until(plan.target.start, input.nowMs)})`);
  }
  if (plan.scoringPeriod) {
    const sp = plan.scoringPeriod;
    out.push(
      // The caps only exist in a league whose config has them: printing
      // « caps GP ? / GS ? » elsewhere invents a rule that was never read.
      `Scoring period ${sp.number}: ${calDay(sp.firstDay)} → ${calDay(sp.lastDay)} · ${sp.daysLeft} lineup days left${
        CFG.features.gamesCaps ? ` · caps GP ${sp.gpMax ?? "?"} / GS ${sp.gsMax ?? "?"}` : ""
      }`,
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
    `Claims this week (since ${w.weekStart}): ${w.claimsUsed ?? "?"}/${CFG.features.claimsPerWeek ?? "?"} used${w.claimsLeft != null ? `, ${w.claimsLeft} left` : ""} · showing gains >= 3 FP, best 3 per position`,
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
      const share = d.poolShare;
      const expected = (m: number) => fx(m * share, 1);
      out.push(
        `Odds: ${d.picksBefore} picks before #${d.next.pick}${d.following ? `, ${d.picksBeforeFollowing ?? "?"} before #${d.following.pick}` : ""}; ~${pct(share)} of picks land on projected players (smoothed from the picks so far; the rest go to prospects), so ~${expected(d.picksBefore)}${d.following ? ` / ~${expected(d.picksBeforeFollowing ?? 0)}` : ""} pool players expected gone (the per-player odds over the whole pool add up to exactly that).`,
      );
      if (d.following) {
        out.push(`VONA by position (expected best at #${d.next.pick} − expected best at #${d.following.pick}):`);
        for (const g of CFG.eligibility.groups) {
          const v = d.vona[g] as (typeof d.vona)[typeof g] | undefined;
          if (!v) continue;
          out.push(
            `  ${g}  ${lpad(v.vona == null ? "n/a" : signed(v.vona, 1), 6)}   #${d.next.pick}: ${pad(`${name(v.bestId)} (${pct(v.bestP)})`, 30)} ~${lpad(fx(v.now, 1), 6)}   #${d.following.pick}: ${pad(`${name(v.laterId)} (${pct(v.laterP)})`, 30)} ~${lpad(fx(v.later, 1), 6)}`,
          );
        }
      } else out.push("Last pick: take the best value.");
    } else out.push("You have no picks left.");
    const availHead = d.next ? `Avail#${d.next.pick}` : "";
    out.push(
      `  ${pad("Best available", 24)} ${pad("Tm", 4)} ${pad("Pos", 10)} ${lpad("SeasonFP", 8)} ${lpad("Value", 6)} ${lpad("VONA", 6)} ${lpad(availHead, 9)}  Age Ros%`,
    );
    for (const b of d.board) {
      out.push(
        `  ${pad(name(b.id), 24)} ${pad(team(b.id), 4)} ${pad(P[b.id]?.e ?? "", 10)} ${lpad(fx(b.seasonFp, 0), 8)} ${lpad(fx(b.value, 0), 6)} ${lpad(b.vona == null ? "-" : signed(b.vona, 1), 6)} ${lpad(d.next ? pct(b.available) : "", 9)}  ${lpad(P[b.id]?.age ?? "?", 3)} ${lpad(P[b.id]?.ros ?? "?", 4)}`,
      );
    }
    out.push(
      `${vorLeague ? "Value = season FP over the replacement level of his position (the weakest starter of the league who could take his seat; run --vor for the levels)." : "Value = season FP + up to 50% when your D/G slots are empty."} Avail = chance he is still there at your next pick (ADP rank among the available with log-normal noise ~35% of the rank, binomial count of pool picks; no-ADP players rank last). Player VONA = value − expected best at his position by your following pick (negative: someone better should last). Prospects (no projection) are not ranked.`,
    );
  }

  if (input.dynasty) printDynasty(out, plan, input, input.dynasty, input.dynastyMode);
  else if (CFG.features.dynasty && !args.includes("--no-dynasty")) {
    out.push("", `(no ${CFG.paths.public}/dynasty.json: run npm run dynasty:build for the dynasty section)`);
  }

  console.log(out.join("\n"));
}

/**
 * Dynasty section: the league's top 25, the team's roster by dynasty value
 * with its phase and a keep / trade hint, and (during a draft) the best
 * available by dynasty value with the odds each one lasts to the next pick.
 */
function printDynasty(
  out: string[],
  plan: DailyPlan,
  input: ReturnType<typeof main>,
  dyn: DynastySnapshot,
  mode: Mode,
) {
  const P = dyn.players;
  const name = (id: string) => P[id]?.n ?? input.values.players[id]?.n ?? id;
  const team = (id: string) => input.values.players[id]?.t ?? "";
  const season = (t: number) => `${26 + t}-${27 + t}`;
  const h = (title: string) => out.push("", `== ${title} ==`);
  const rank = (id: string) => P[id]?.rank[mode] ?? Number.POSITIVE_INFINITY;
  const dvCell = (id: string) => lpad(fx(P[id]?.dv[mode] ?? 0, 0), 5);

  h(`Dynasty value: ${MODE_FR[mode]} (delta ${dyn.params.modes[mode].delta}), built ${dyn.builtAt.slice(0, 10)}`);
  out.push(
    `Points de dynastie: realized FP above the waiver line over 12 seasons (captain premium in), minus the keeper-slot cost K = ${fx(dyn.params.K.value, 1)}/season once no longer minors-eligible (160 protected league-wide). Not the projected-FP scale above.`,
  );
  out.push(
    `  ${lpad("Rk", 4)} ${pad("Player", 22)} ${pad("Tm", 4)} Pos ${lpad("Age", 4)} ${pad("Phase", 20)} ${lpad("DV", 5)} ${pad("  P10-P90", 12)} ${pad(`P50 by season ${season(0)}..${season(5)}`, 30)} Keeper 2027`,
  );
  const top = Object.keys(P)
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, 25);
  const bandCell = (id: string) => {
    const b = mode === "longTerm" ? P[id]!.band.longTerm : P[id]!.band.balanced;
    return pad(`  ${fx(b[0], 0)}-${fx(b[2], 0)}`, 12);
  };
  const p50Cell = (id: string) => pad(P[id]!.p50G.slice(0, 6).join(" "), 30);
  // league-wide status (the 160th keeper): the value basis, as on a generic roster
  const keeperCell = (id: string) => {
    const r = P[id]!;
    return r.keeper.status === "free"
      ? `${KEEPER_FR.free}${r.elig.freeThrough != null ? ` (jusqu'en ${r.elig.freeThrough + 1})` : ""}`
      : `${KEEPER_FR[r.keeper.status]}${r.keeper.pKept27 != null ? ` (P ${pct(r.keeper.pKept27)})` : ""}`;
  };
  // roster view: against the player's own team's 10 keeper slots
  const teamKeeperCell = (id: string) => {
    const r = P[id]!;
    const kv = keeperView(r);
    if (!kv.team) return `${keeperCell(id)} [ligue]`;
    return kv.status === "free"
      ? `${KEEPER_TEAM_FR.free}${r.elig.freeThrough != null ? ` (jusqu'en ${r.elig.freeThrough + 1})` : ""}`
      : `${KEEPER_TEAM_FR[kv.status]}${kv.p != null ? ` (P ${pct(kv.p)}${kv.rank != null ? `, ${kv.rank}e` : ""})` : ""}`;
  };
  for (const id of top) {
    const r = P[id]!;
    out.push(
      `  ${lpad(r.rank[mode], 4)} ${pad(name(id), 22)} ${pad(team(id), 4)} ${pad(r.g, 3)} ${lpad(fx(r.age, 1), 4)} ${pad(PHASE_FR[r.phase], 20)} ${dvCell(id)} ${bandCell(id)} ${p50Cell(id)} ${keeperCell(id)}`,
    );
  }

  // ---- the team's roster
  const roster = input.state.rosters[plan.teamId] ?? [];
  const ids = roster.map((r) => r.id);
  const prot = dynastyDropProtection(ids, dyn);
  h(`${plan.teamName}: roster by dynasty value (${MODE_FR[mode]})`);
  out.push(
    `  ${lpad("Rk", 5)} ${pad("Player", 22)} ${pad("St", 7)} Pos ${lpad("Age", 4)} ${pad("Phase", 20)} ${lpad("DV", 5)} ${lpad("LT", 5)} ${pad("Keeper 2027 (team's 10 slots)", 52)} Hint`,
  );
  const sorted = [...ids].sort((a, b) => rank(a) - rank(b));
  for (const id of sorted) {
    const r = P[id];
    const st = statusWord(roster.find((x) => x.id === id)?.status);
    if (!r) {
      out.push(`  ${lpad("-", 5)} ${pad(name(id), 22)} ${pad(st, 7)} (not modeled)`);
      continue;
    }
    out.push(
      `  ${lpad(r.rank[mode], 5)} ${pad(name(id), 22)} ${pad(st, 7)} ${pad(r.g, 3)} ${lpad(fx(r.age, 1), 4)} ${pad(PHASE_FR[r.phase], 20)} ${dvCell(id)} ${lpad(fx(r.dv.longTerm, 0), 5)} ${pad(teamKeeperCell(id), 52)} ${rosterHintFr(r)}${prot.protected.has(id) ? "" : " (droppable)"}`,
    );
  }
  const counts = { free: 0, core: 0, bubble: 0, rental: 0 };
  let expKept = 0;
  let teamView = false;
  for (const id of ids) {
    const r = P[id];
    if (!r) continue;
    const kv = keeperView(r);
    teamView ||= kv.team;
    counts[kv.status]++;
    if (kv.status !== "free" && kv.p != null) expKept += kv.p * (1 - r.elig.next);
  }
  out.push(
    `  2027 cutdown outlook (${teamView ? "the team's own 10 slots" : "league-wide line"}): ${counts.core} safe keepers, ${counts.bubble} on the line, ${counts.rental} outside, ${counts.free} free minors stashes; expected keepers from this roster ${fx(expKept, 1)} of 10 (keep 10 + 30 minors-eligible).`,
  );
  for (const id of sorted.filter((x) => P[x]).slice(0, 3)) out.push(`  ${name(id)}: ${explainFr(P[id]!)}`);

  // ---- best available during the draft
  const d = plan.draft;
  if (d) {
    const rostered = new Set(Object.values(input.state.rosters).flatMap((r) => r.map((x) => x.id)));
    const drafted = new Set((input.state.draft?.picks ?? []).map((p) => p.playerId).filter(Boolean) as string[]);
    const available = Object.keys(P).filter((id) => {
      if (rostered.has(id) || drafted.has(id)) return false;
      const v = input.values.players[id];
      return !v || !isRuledOut({ team: v.t, icons: input.state.icons[id] ?? [] });
    });
    const need: Partial<Record<"D" | "G", number>> = {};
    for (const g of ["D", "G"] as const) {
      const slots = plan.baseLineup.slots.filter((x) => x.slot === g);
      need[g] = slots.length ? slots.filter((x) => !x.id || x.value <= 0).length / slots.length : 0;
    }
    const board = dynastyBoard(dyn, available, {
      mode,
      need,
      picksBefore: d.next ? d.picksBefore : null,
      picksBeforeFollowing: d.following ? (d.picksBeforeFollowing ?? null) : null,
      limit: 20,
    });
    const odds = d.next ? `, odds at #${d.next.pick}${d.following ? ` / #${d.following.pick}` : ""}` : "";
    h(`Best available by dynasty value (${MODE_FR[mode]}${odds})`);
    out.push(
      `  ${pad("Player", 22)} ${pad("Tm", 4)} Pos ${lpad("Age", 4)} ${pad("Phase", 20)} ${lpad("Value", 5)} ${lpad("DV", 5)} ${lpad("LT", 5)} ${lpad("Mkt#", 5)} ${lpad("Avail", 6)} ${lpad("Next", 6)}  Why`,
    );
    for (const b of board) {
      const r = P[b.id]!;
      out.push(
        `  ${pad(name(b.id), 22)} ${pad(team(b.id), 4)} ${pad(r.g, 3)} ${lpad(fx(r.age, 1), 4)} ${pad(PHASE_FR[r.phase], 20)} ${lpad(fx(b.value, 0), 5)} ${dvCell(b.id)} ${lpad(fx(r.dv.longTerm, 0), 5)} ${lpad(b.marketRank == null ? "-" : fx(b.marketRank, 0), 5)} ${lpad(d.next ? pct(b.available) : "", 6)} ${lpad(b.availableFollowing == null ? "" : pct(b.availableFollowing), 6)}  ${explainFr(r, 140)}`,
      );
    }
    out.push(
      "  Value = DV + up to 50% of this season's gain when your D/G slots are empty. Every pick counts here (prospects included). Mkt# = market rank among the available (geometric mean of the Ros% and ADP ranks); Avail = chance he lasts to your pick.",
    );
  }
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
    case "fxpa-closed":
      return `${tag} This league publishes no player details: no injury flags, no Ros%, no waiver priority. The optimal lineup does not know who is hurt`;
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
  if (args.includes("--priors")) {
    reportPriors();
    return;
  }
  if (args.includes("--vor")) {
    reportVor();
    return;
  }
  const input = main();
  if (args.includes("--live")) await refreshLive(input);
  // The board's value model, same as the sync's and the browser's.
  const vor = leagueVor(CFG, input.values.players, (id) => seasonFp(input.values.players[id]!, CFG), input.league.slotCounts);
  const plan = buildDailyPlan({ ...input, config: CFG, vor });
  print(plan, input);
})().catch((e) => {
  console.error(`FAIL: league:report — ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});

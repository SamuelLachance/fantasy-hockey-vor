/**
 * Writes the player cards' data (public/joueurs/<shard>.json, not committed):
 * one compact record per NHL player — identity, draft, NHL contract,
 * durability, career by season, this season's projection — sharded by NHL id
 * (id % 64) so a card fetches one small file. The league parts of a card
 * (owners, dynasty values, asset scores, contracts, board ranks) come from
 * each league's own published files in the browser.
 *
 * Sources: src/data/player-profiles.json, src/data/players.json,
 * src/data/nhl-rosters.json + src/data/nhl-org-bios.json (organisation
 * players without a profile). Run before every site build (build:pages).
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { salarySchedule } from "../src/lib/dynasty/league-contracts";
import { CARD_SHARDS, cardShard, percentileOf, type CardFile, type FantraxCardPart, type PlayerCardData } from "../src/lib/player-card";

const root = process.cwd();
const read = <T>(p: string): T => JSON.parse(readFileSync(join(root, p), "utf8")) as T;
const r1 = (x: number) => Math.round(x * 10) / 10;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

interface Season {
  season: string;
  team: string;
  gamesPlayed: number;
  isGoalie: boolean;
  stats?: Record<string, number>;
  advanced?: Record<string, number>;
}
interface Profile {
  id: number;
  name: string;
  team: string;
  position: string;
  positions?: string[];
  isGoalie: boolean;
  bio: { birthDate?: string; birthCity?: string; birthCountry?: string; heightInches?: number; weightPounds?: number; shootsCatches?: string; sweaterNumber?: number };
  draft?: { year: number; round: number; overallPick: number; team: string } | null;
  contract?: { capHitUsd?: number; yearsRemaining?: number; expiryStatus?: string; contractType?: string } | null;
  injury?: { trend?: string; note?: string; durabilityScore?: number; gamesPlayedLastSeason?: number };
  teamHistory: Season[];
}

const profiles = read<{ profiles: Profile[] }>("src/data/player-profiles.json").profiles;
const players = read<{ generatedAt: string; players: Array<{ id: number; name: string; team: string; positions?: string[]; isGoalie: boolean; gamesPlayed: number; projection: Record<string, number>; inSeason?: { gp: number; stats: Record<string, number>; injury: { status: string; returnDate: string | null; gamesOut: number; note: string | null; since?: string | null } | null } }> }>(
  "src/data/players.json",
);
const projById = new Map(players.players.map((p) => [p.id, p]));
const rosters = existsSync(join(root, "src/data/nhl-rosters.json"))
  ? Object.values(read<{ players: Record<string, { id: number; name: string; team: string; code: string; birthDate: string | null; list: string }> }>("src/data/nhl-rosters.json").players)
  : [];
const orgBios = existsSync(join(root, "src/data/nhl-org-bios.json"))
  ? read<{ players: Record<string, { b?: string; d?: [number, number, string]; p?: string }> }>("src/data/nhl-org-bios.json").players
  : {};

const cards = new Map<number, PlayerCardData>();

for (const pr of profiles) {
  const proj = projById.get(pr.id);
  const hist = pr.teamHistory
    .filter((s) => s.gamesPlayed > 0)
    .map((s) => {
      const st = s.stats ?? {};
      const adv = s.advanced ?? {};
      if (s.isGoalie) {
        return [s.season, s.team, s.gamesPlayed, st.wins ?? 0, r3(st.savePct ?? 0), Math.round((st.gaa ?? 0) * 100) / 100, st.shutouts ?? 0] as (string | number)[];
      }
      return [
        s.season,
        s.team,
        s.gamesPlayed,
        st.goals ?? 0,
        st.assists ?? 0,
        st.ppPoints ?? 0,
        st.shots ?? 0,
        adv.hits ?? 0,
        adv.blocks ?? 0,
        r1((st.toiPerGame ?? 0) / 60),
      ] as (string | number)[];
    });
  const p = proj?.projection ?? null;
  cards.set(pr.id, {
    id: pr.id,
    n: pr.name,
    t: proj?.team ?? pr.team,
    pos: proj?.positions ?? pr.positions ?? [pr.position],
    g: pr.isGoalie,
    num: pr.bio.sweaterNumber ?? null,
    bd: pr.bio.birthDate ?? null,
    from: [pr.bio.birthCity, pr.bio.birthCountry].filter(Boolean).join(", ") || null,
    h: pr.bio.heightInches ?? null,
    w: pr.bio.weightPounds ?? null,
    sh: pr.bio.shootsCatches ?? null,
    dr: pr.draft ? [pr.draft.year, pr.draft.round, pr.draft.overallPick, pr.draft.team] : null,
    k: pr.contract?.capHitUsd
      ? { cap: r3(pr.contract.capHitUsd / 1e6), yrs: pr.contract.yearsRemaining ?? null, st: pr.contract.expiryStatus ?? null, ty: pr.contract.contractType ?? null }
      : null,
    inj: pr.injury ? { tr: pr.injury.trend ?? null, d: pr.injury.durabilityScore ?? null } : null,
    hist,
    cur: proj?.inSeason && proj.inSeason.gp > 0 ? { gp: proj.inSeason.gp, s: proj.inSeason.stats } : null,
    injNow: proj?.inSeason?.injury
      ? {
          st: proj.inSeason.injury.status,
          ret: proj.inSeason.injury.returnDate,
          out: proj.inSeason.injury.gamesOut,
          note: proj.inSeason.injury.note,
          since: proj.inSeason.injury.since ?? null,
        }
      : null,
    proj: p
      ? pr.isGoalie
        ? { gp: proj!.gamesPlayed, w: r1(p.wins ?? 0), sv: r3(p.savePct ?? 0), gaa: proj!.gamesPlayed > 0 && (p.savePct ?? 0) > 0 ? Math.round((((p.saves ?? 0) * (1 - p.savePct!)) / p.savePct! / proj!.gamesPlayed) * 100) / 100 : 0, so: r1(p.shutouts ?? 0) }
        : {
            gp: proj!.gamesPlayed,
            g: r1(p.goals ?? 0),
            a: r1(p.assists ?? 0),
            ppp: r1(p.powerplayPoints ?? 0),
            sog: r1(p.shots ?? 0),
            hit: r1(p.hits ?? 0),
            blk: r1(p.blocks ?? 0),
            pim: r1(p.penaltyMinutes ?? 0),
          }
      : null,
  });
}
// organisation players without a profile: identity and draft only
for (const r of rosters) {
  if (cards.has(r.id)) continue;
  const bio = orgBios[String(r.id)];
  cards.set(r.id, {
    id: r.id,
    n: r.name,
    t: r.team,
    pos: [bio?.p ?? r.code],
    g: (bio?.p ?? r.code) === "G",
    num: null,
    bd: r.birthDate ?? bio?.b ?? null,
    from: null,
    h: null,
    w: null,
    sh: null,
    dr: bio?.d ? [bio.d[0], null, bio.d[1], bio.d[2]] : null,
    k: null,
    inj: null,
    hist: [],
    proj: null,
  });
}

// ---------------------------------------------------------------- league parts
type Trio = { W: number; B: number; L: number };
interface DynRec {
  n: string;
  phase: string;
  dv: { winNow: number; balanced: number; longTerm: number };
  rank: { winNow: number; balanced: number; longTerm: number };
  eG: number[];
  keeper?: { status: string; pKept27: number | null };
}
const trio = (x: { winNow: number; balanced: number; longTerm: number }): Trio => ({ W: r1(x.winNow), B: r1(x.balanced), L: r1(x.longTerm) });
/** fx id → NHL id, and the Fantrax-only players (no NHL id) by fx id, per league. */
const fxIndex: Record<string, Record<string, [number, string]>> = {};

function fantraxLeague(slug: "captains" | "slapshot", dir: string, leagueFile: string) {
  const pool = existsSync(join(root, dir, "pool.json")) ? read<{ players: Array<{ id: string; n: string; nhl?: number }> }>(join(dir, "pool.json")).players : [];
  const dyn = existsSync(join(root, dir, "dynasty-table.json")) ? read<{ players: Record<string, DynRec> }>(join(dir, "dynasty-table.json")).players : {};
  const state = existsSync(join(root, dir, "state.json")) ? read<{ rosters: Record<string, Array<{ id: string; status: string }>> }>(join(dir, "state.json")).rosters : {};
  const teams = new Map(read<{ teams: Array<{ id: string; name: string }> }>(leagueFile).teams.map((t) => [t.id, t.name]));
  const plan =
    slug === "slapshot" && existsSync(join(root, dir, "cap-plan.json"))
      ? read<{ min: number[]; rules: { mult: number[]; maxYears: number; extensions: number }; cap: number; floor: number; players: Record<string, { s: number; n: number[]; y: number; e: number; b: number; eb: number | null; f?: 1; by: Record<"B", Array<[number, number]>> }> }>(
          join(dir, "cap-plan.json"),
        )
      : null;
  const owner = new Map<string, { team: string; status: string }>();
  for (const [team, list] of Object.entries(state)) for (const e of list) owner.set(e.id, { team, status: e.status });
  // asset score: percentile of the dynasty value among rostered players, per horizon
  const scales = { W: [] as number[], B: [] as number[], L: [] as number[] };
  for (const id of owner.keys()) {
    const d = dyn[id];
    scales.W.push(d ? d.dv.winNow : 0);
    scales.B.push(d ? d.dv.balanced : 0);
    scales.L.push(d ? d.dv.longTerm : 0);
  }
  for (const k of ["W", "B", "L"] as const) scales[k].sort((a, b) => a - b);
  const idx: Record<string, [number, string]> = {};
  for (const r of pool) {
    idx[r.id] = [r.nhl ?? 0, r.n];
    if (!r.nhl) continue;
    const card = cards.get(r.nhl);
    if (!card) continue;
    const d = dyn[r.id] ?? null;
    const o = owner.get(r.id) ?? null;
    const part: FantraxCardPart = {
      fx: r.id,
      own: o?.team ?? null,
      ownName: o ? (teams.get(o.team) ?? null) : null,
      st: o?.status ?? null,
      dv: d ? trio(d.dv) : null,
      rk: d ? { W: d.rank.winNow, B: d.rank.balanced, L: d.rank.longTerm } : null,
      sc: d
        ? { W: percentileOf(scales.W, d.dv.winNow), B: percentileOf(scales.B, d.dv.balanced), L: percentileOf(scales.L, d.dv.longTerm) }
        : null,
      ph: d?.phase ?? null,
      eG: d ? d.eG.slice(0, 6).map(r1) : null,
    };
    if (slug === "captains") part.kp = d?.keeper ? { st: d.keeper.status, p: d.keeper.pKept27 } : null;
    const pp = plan?.players[r.id];
    if (plan && pp) {
      // the balanced recommendation (a confirmed contract stays)
      let y = pp.y;
      if (!pp.f) pp.by.B.forEach(([t], j) => (t > (pp.by.B[y - 1]?.[0] ?? -Infinity) + 1e-9 ? (y = j + 1) : null));
      const e = pp.by.B[y - 1]?.[1] ?? pp.e;
      const rules = { ...plan.rules, cap: plan.cap, floor: plan.floor };
      const sch = salarySchedule(pp.s, pp.b, y, e, pp.n, plan.min, pp.n.length, rules);
      part.ct = { y, e, b: pp.b, eb: sch.extBase, f: !!pp.f, sal: sch.salary.slice(0, 7), start: pp.s };
    }
    card.lg = { ...card.lg, [slug]: part };
  }
  fxIndex[slug] = idx;
}
fantraxLeague("captains", "public/fantrax", "src/data/fantrax/league.json");
fantraxLeague("slapshot", "public/fantrax/slapshot", "src/data/fantrax/slapshot/league.json");

// Light the Lamp: board (ranked, hand moves) then the rest of the pool
{
  const dir = "public/leagues/light-the-lamp";
  type LtlRow = { id: number; rank?: number; vor?: number; posRank?: Record<string, number>; z?: number[]; adjusted?: { reason: string } };
  const board = existsSync(join(root, dir, "board.json")) ? read<{ players: LtlRow[] }>(join(dir, "board.json")).players : [];
  const pool = existsSync(join(root, dir, "pool.json")) ? read<{ players: LtlRow[] }>(join(dir, "pool.json")).players : [];
  for (const [rows, onBoard] of [[board, true], [pool, false]] as const) {
    for (const r of rows) {
      const card = cards.get(r.id);
      if (!card || card.lg?.ltl) continue;
      card.lg = {
        ...card.lg,
        ltl: { rank: r.rank ?? null, vor: r.vor == null ? null : r1(r.vor), posRank: r.posRank ?? null, z: r.z ?? null, adjusted: r.adjusted?.reason ?? null, onBoard },
      };
    }
  }
}

// Snake: his page key, verdict and trend
{
  const p = "public/snake/nhl.json";
  if (existsSync(join(root, p))) {
    const rows = read<{ rows: Record<string, [string, string, string, number]> }>(p).rows;
    for (const [id, [key, verdict, trend]] of Object.entries(rows)) {
      const card = cards.get(Number(id));
      if (card) card.sn = [key, verdict, trend];
    }
  }
}

const dir = join(root, "public", "joueurs");
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const projAt = (players as { inSeasonAt?: string }).inSeasonAt ?? players.generatedAt;
const shards: CardFile[] = Array.from({ length: CARD_SHARDS }, () => ({ v: 1, projectionsAt: projAt, players: {} }));
for (const c of cards.values()) shards[cardShard(c.id)]!.players[c.id] = c;
shards.forEach((s, i) => writeFileSync(join(dir, `${String(i).padStart(2, "0")}.json`), `${JSON.stringify(s)}\n`));
// a Fantrax id -> [NHL id (0: none), name], for /joueur?fx=...&ligue=...
for (const [slug, idx] of Object.entries(fxIndex)) writeFileSync(join(dir, `fx-${slug}.json`), `${JSON.stringify(idx)}
`);
console.log(`OK: player cards for ${cards.size} players in ${CARD_SHARDS} shards → public/joueurs/`);

/**
 * Hard gates on a built dynasty snapshot (§9.1), shared by check:league and
 * the build report. Pure: callers pass the snapshot and the league signals.
 */
import { MODES, type DynastyRecord, type DynastySnapshot } from "./types";

export interface GateInputs {
  snapshot: DynastySnapshot;
  /** values.json players (id → src). */
  values: Record<string, { src: "proj" | "prior" }>;
  rostered: ReadonlySet<string>;
  adp: Record<string, number>;
  ros: Record<string, number>;
  minorsEligible: ReadonlySet<string>;
  /** Research 2027 keep score (non-eligible players), optional. */
  keepScore27?: Record<string, number>;
}

export interface GateResult {
  errors: string[];
  warnings: string[];
  stats: Record<string, number>;
}

export const GATES = {
  K: [30, 55] as const,
  top100: { G: [10, 20], D: [10, 20], prospect: [1, 6] } as const,
  top200ProspectsLongTerm: [20, 45] as const,
  /**
   * Long-term mode (audit 2026-09-25): its top 100 is at least this much
   * younger (median age) than the balanced top 100, and nobody whose value
   * ends within two seasons (≥ 80% of the summed eG in 2026-27 and 2027-28)
   * ranks in its top `shortLivedMaxRank`.
   */
  longTerm: { youngerBy: 1, shortLivedMaxRank: 150 },
  spearmanAdp: 0.75,
  spearmanKeep: 0.78,
  spearmanRos: 0.55,
  /**
   * Year-0 depth-chart starts of a club's goalies: at least this share of
   * their projected GP (capped at a season), at most `max`; a warning below
   * `warnBelow` (thin goalie data for that club).
   */
  teamGoalieStarts: { minShareOfRef: 0.9, max: 90, warnBelow: 60 },
};

/** Spearman rank correlation (average ranks on ties). */
export function spearman(a: readonly number[], b: readonly number[]): number {
  const n = a.length;
  if (n < 3) return Number.NaN;
  const rank = (x: readonly number[]) => {
    const idx = x.map((v, i) => [v, i] as const).sort((p, q) => p[0] - q[0]);
    const r = new Array<number>(n);
    for (let i = 0; i < n; ) {
      let j = i;
      while (j + 1 < n && idx[j + 1]![0] === idx[i]![0]) j++;
      for (let k = i; k <= j; k++) r[idx[k]![1]] = (i + j) / 2;
      i = j + 1;
    }
    return r;
  };
  const ra = rank(a);
  const rb = rank(b);
  const ma = ra.reduce((s, x) => s + x, 0) / n;
  const mb = rb.reduce((s, x) => s + x, 0) / n;
  let s = 0;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < n; i++) {
    s += (ra[i]! - ma) * (rb[i]! - mb);
    sa += (ra[i]! - ma) ** 2;
    sb += (rb[i]! - mb) ** 2;
  }
  return s / Math.sqrt(sa * sb);
}

const finite = (x: unknown) => typeof x === "number" && Number.isFinite(x);

function recordProblems(id: string, r: DynastyRecord, T: number): string[] {
  const bad: string[] = [];
  if (typeof r.n !== "string" || !r.n) bad.push("name");
  if (!["F", "D", "G"].includes(r.g)) bad.push("g");
  if (!["nhl", "prospect", "fringe"].includes(r.path)) bad.push("path");
  if (!finite(r.age)) bad.push("age");
  for (const m of MODES) {
    if (!finite(r.dv?.[m])) bad.push(`dv.${m}`);
    if (!(Number.isInteger(r.rank?.[m]) && r.rank[m] > 0)) bad.push(`rank.${m}`);
  }
  for (const k of ["eG", "eFP", "p50G"] as const) {
    const a = r[k];
    if (!Array.isArray(a) || a.length !== T || !a.every(finite)) bad.push(k);
  }
  for (const k of ["balanced", "longTerm"] as const) {
    const b = r.band?.[k];
    if (!Array.isArray(b) || b.length !== 3 || !b.every(finite) || b[0]! > b[1]! || b[1]! > b[2]!) bad.push(`band.${k}`);
  }
  if (!finite(r.pNhl) || r.pNhl < 0 || r.pNhl > 1) bad.push("pNhl");
  if (!r.elig || !finite(r.elig.next)) bad.push("elig");
  if (!r.keeper || !["free", "core", "bubble", "rental"].includes(r.keeper.status)) bad.push("keeper");
  if (!r.market || !finite(r.market.w)) bad.push("market");
  return bad.length ? [`${id} (${r.n}): ${bad.join(", ")}`] : [];
}

export function dynastyGates(inp: GateInputs): GateResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const stats: Record<string, number> = {};
  const s = inp.snapshot;
  if (s.version !== 1 || !s.players || typeof s.players !== "object") {
    return { errors: ["dynasty.json: unknown version or no players"], warnings, stats };
  }
  const T = s.params?.T ?? 12;
  const recs = Object.entries(s.players);
  stats.players = recs.length;
  const problems = recs.flatMap(([id, r]) => recordProblems(id, r, T));
  if (problems.length) errors.push(`${problems.length} malformed dynasty records (e.g. ${problems.slice(0, 3).join("; ")})`);
  if (/"owner/i.test(JSON.stringify(s))) errors.push("dynasty.json carries an owner field");

  // coverage
  const missingRostered = [...inp.rostered].filter((id) => inp.values[id] && !s.players[id]);
  if (missingRostered.length) errors.push(`${missingRostered.length} rostered players missing from dynasty.json (e.g. ${missingRostered[0]})`);
  const zero = new Set(Array.isArray(s.zero) ? s.zero : []);
  const zeroRostered = [...zero].filter((id) => inp.rostered.has(id));
  if (zeroRostered.length) errors.push(`${zeroRostered.length} rostered players listed as zero-value (e.g. ${zeroRostered[0]})`);
  const proj = Object.entries(inp.values).filter(([, v]) => v.src === "proj").map(([id]) => id);
  const missingProj = proj.filter((id) => !s.players[id] && !zero.has(id));
  stats.projMissing = missingProj.length;
  if (missingProj.length) errors.push(`${missingProj.length} projected players missing from dynasty.json (e.g. ${missingProj[0]})`);

  // K
  const K = s.params.K.value;
  stats.K = K;
  if (!(K >= GATES.K[0] && K <= GATES.K[1])) errors.push(`K = ${K} outside [${GATES.K.join(", ")}]`);

  // composition
  const byRank = (m: "balanced" | "longTerm") =>
    recs.map(([id, r]) => ({ id, r })).sort((a, b) => a.r.rank[m] - b.r.rank[m]);
  const top100 = byRank("balanced").slice(0, 100).map((x) => x.r);
  const cG = top100.filter((r) => r.g === "G").length;
  const cD = top100.filter((r) => r.g === "D").length;
  const cP = top100.filter((r) => r.phase === "prospect").length;
  const cP200 = byRank("longTerm").slice(0, 200).filter((x) => x.r.phase === "prospect").length;
  Object.assign(stats, { top100G: cG, top100D: cD, top100Prospects: cP, top200LtProspects: cP200 });
  const inRange = (x: number, [lo, hi]: readonly [number, number]) => x >= lo && x <= hi;
  if (!inRange(cG, GATES.top100.G)) errors.push(`top 100 (balanced) has ${cG} goalies, expected ${GATES.top100.G.join("-")}`);
  if (!inRange(cD, GATES.top100.D)) errors.push(`top 100 (balanced) has ${cD} D, expected ${GATES.top100.D.join("-")}`);
  if (!inRange(cP, GATES.top100.prospect)) errors.push(`top 100 (balanced) has ${cP} prospects, expected ${GATES.top100.prospect.join("-")}`);
  if (!inRange(cP200, GATES.top200ProspectsLongTerm)) {
    errors.push(`top 200 (long-term) has ${cP200} prospects, expected ${GATES.top200ProspectsLongTerm.join("-")}`);
  }

  // long-term mode: younger than balanced, no two-season rentals near the top
  const medAge = (rs: DynastyRecord[]) => [...rs.map((r) => r.age)].sort((a, b) => a - b)[rs.length >> 1] ?? 0;
  const ltTop = byRank("longTerm").slice(0, 100).map((x) => x.r);
  stats.top100MedianAgeBalanced = medAge(top100);
  stats.top100MedianAgeLongTerm = medAge(ltTop);
  if (!(stats.top100MedianAgeLongTerm <= stats.top100MedianAgeBalanced - GATES.longTerm.youngerBy)) {
    errors.push(`long-term top 100 median age ${stats.top100MedianAgeLongTerm} not ${GATES.longTerm.youngerBy} year younger than balanced ${stats.top100MedianAgeBalanced}`);
  }
  const shortLived = byRank("longTerm")
    .slice(0, GATES.longTerm.shortLivedMaxRank)
    .filter(({ r }) => {
      const tot = r.eG.reduce((s2, x) => s2 + Math.max(0, x), 0);
      return tot > 0 && (Math.max(0, r.eG[0]!) + Math.max(0, r.eG[1]!)) / tot >= 0.8;
    });
  stats.longTermShortLived = shortLived.length;
  if (shortLived.length) {
    errors.push(`${shortLived.length} players whose value ends within two seasons rank in the long-term top ${GATES.longTerm.shortLivedMaxRank} (e.g. ${shortLived[0]!.r.n} #${shortLived[0]!.r.rank.longTerm})`);
  }

  // Spearman sanity against the league's own signals (zero-value players count at 0)
  const dvOf = (id: string, m: "balanced" | "longTerm") => s.players[id]?.dv[m] ?? 0;
  const universe = [...Object.keys(s.players), ...zero];
  const withAdp = universe.filter((id) => inp.adp[id] != null && inp.adp[id]! < 280);
  const rhoAdp = spearman(withAdp.map((id) => dvOf(id, "balanced")), withAdp.map((id) => -inp.adp[id]!));
  stats.spearmanAdp = rhoAdp;
  if (!(rhoAdp >= GATES.spearmanAdp)) errors.push(`Spearman DV vs ADP ${rhoAdp.toFixed(3)} < ${GATES.spearmanAdp}`);
  if (inp.keepScore27) {
    const ks = inp.keepScore27;
    const withKeep = universe.filter((id) => ks[id] != null && !inp.minorsEligible.has(id) && !(s.players[id]?.elig.now ?? false));
    const rhoKeep = spearman(withKeep.map((id) => dvOf(id, "balanced")), withKeep.map((id) => ks[id]!));
    stats.spearmanKeep = rhoKeep;
    if (!(rhoKeep >= GATES.spearmanKeep)) errors.push(`Spearman DV vs keepScore27 ${rhoKeep.toFixed(3)} < ${GATES.spearmanKeep}`);
  }
  const rosElig = universe.filter((id) => inp.rostered.has(id) && inp.minorsEligible.has(id));
  const rhoRos = spearman(rosElig.map((id) => dvOf(id, "longTerm")), rosElig.map((id) => inp.ros[id] ?? 0));
  stats.spearmanRos = rhoRos;
  if (!(rhoRos >= GATES.spearmanRos)) errors.push(`Spearman long-term DV vs Ros% ${rhoRos.toFixed(3)} < ${GATES.spearmanRos}`);

  // aging guard: established skaters must not gain value with age
  const rising = recs.filter(
    ([, r]) => r.path === "nhl" && r.g !== "G" && r.age >= 27 && r.eG[3]! > 1.03 * r.eG[1]! + 1,
  );
  stats.agingViolations = rising.length;
  if (rising.length) errors.push(`${rising.length} skaters aged 27+ gain value with age (e.g. ${rising[0]![1].n})`);

  // goalie depth: no club may lose its starter's season to a status flag (or double-count one)
  const starts = s.diag?.goalieStarts0;
  if (starts) {
    const G = GATES.teamGoalieStarts;
    const rows = Object.entries(starts);
    stats.teamGoalieStartsMin = Math.min(...rows.map(([, x]) => x.starts));
    stats.teamGoalieStartsMax = Math.max(...rows.map(([, x]) => x.starts));
    const lost = rows.filter(([, x]) => x.starts < G.minShareOfRef * x.ref - 0.5);
    if (lost.length) {
      errors.push(
        `${lost.length} teams lost year-0 goalie starts to a status flag (${lost.slice(0, 4).map(([t, x]) => `${t} ${x.starts} of ${x.ref}`).join(", ")})`,
      );
    }
    const over = rows.filter(([, x]) => x.starts > G.max);
    if (over.length) errors.push(`${over.length} teams have more than ${G.max} year-0 goalie starts (e.g. ${over[0]![0]} ${over[0]![1].starts})`);
    const thin = rows.filter(([, x]) => x.starts < G.warnBelow);
    if (thin.length) warnings.push(`thin goalie depth data: ${thin.map(([t, x]) => `${t} ${x.starts}`).join(", ")} year-0 starts`);
  }

  if (!Number.isFinite(Date.parse(s.builtAt))) errors.push(`dynasty.builtAt invalid: ${s.builtAt}`);
  return { errors, warnings, stats };
}

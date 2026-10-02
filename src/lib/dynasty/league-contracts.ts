/**
 * Slapshot league contracts (SFHL rulebook §2.3-2.4, owner answers of
 * 2026-10-02). Every player signs a league contract of 1 to 7 seasons whose
 * base (year 1) is his real NHL cap hit of the signing season; each later year
 * raises the previous year (years 2-3 +10 %, years 4-6 +15 %, year 7 +20 %, compounded).
 * A contract may be extended ONCE, for any length, under the same rules (the
 * base is then his real NHL cap hit of the extension's first season). When
 * the contract (and its one extension) ends, the player is an unrestricted
 * free agent whatever his age: the team loses him. The cap (105 M$) and the
 * floor (70 M$) are fixed and count the 23 active + reserve players only;
 * minors and IR are free.
 *
 * The planner picks the length that maximises the owner's discounted surplus:
 * each season he holds the player he either plays him (value − λ × (salary −
 * league minimum)) or sends him to the minors (0 points, 0 cap), so a season
 * is worth max(0, value − charge); after control ends it is worth 0. λ is the
 * cap's shadow price (league points per M$), from the dynasty build. Since
 * a stashed season costs nothing in that objective, many lengths come within
 * a hair of the best: near-ties (`contractTie`) go to the shortest total
 * control (`recommendedLength`), the « Plafond » tab's rule too.
 *
 * Pure: used by the dynasty build and by the browser's « Plafond » tab.
 */

export interface LeagueContractRules {
  /** Salary multiplier of contract year 1..maxYears on the base (the raises compounded). */
  mult: readonly number[];
  maxYears: number;
  /** Extensions a contract may get (1). */
  extensions: number;
  /** League cap and floor per season, M$ (fixed). */
  cap: number;
  floor: number;
}

export const SLAPSHOT_CONTRACT_RULES: LeagueContractRules = {
  mult: [1, 1.1, 1.21, 1.3915, 1.600225, 1.84025875, 2.2083105],
  maxYears: 7,
  extensions: 1,
  cap: 105,
  floor: 70,
};

const r2 = (x: number) => Math.round(x * 100) / 100;

/** Salaries of a contract, year by year (M$, 2 dp). */
export function contractSalaries(base: number, years: number, rules: LeagueContractRules = SLAPSHOT_CONTRACT_RULES): number[] {
  const n = Math.max(0, Math.min(rules.maxYears, Math.floor(years)));
  return Array.from({ length: n }, (_, j) => r2(base * (rules.mult[j] ?? rules.mult[rules.mult.length - 1]!)));
}

export interface ContractPlanInput {
  /** Season index the first league contract starts (0 = the first season); a prospect starts when he gets an NHL contract. */
  start: number;
  /** His real NHL cap hit per season (signed, then projected), M$: the base of a contract signed that season. */
  nhl: readonly number[];
  /** Expected value per season before the cap, league points above replacement (may be negative). */
  value: readonly number[];
  /** Cap shadow price per season, league points per M$ above the minimum. */
  lambda: readonly number[];
  /** League minimum salary per season, M$. */
  min: readonly number[];
  /** Discount per season (the dynasty horizon's δ). */
  delta: number;
  /** A confirmed first contract (years, and its base when known). */
  fixed?: { years: number; base?: number } | null;
  /** The extension is already used (no further control after the first contract). */
  extended?: boolean;
  /** The league's own first-season salary (Fantrax, ELC bonuses included): the base of a contract starting now. */
  base0?: number | null;
  /**
   * Seasons 0 … base0Through − 1 are his current signed NHL contract, whose
   * league salary is base0: a contract or extension starting in them takes
   * max(NHL cap hit, base0) (capwages' entry-level hits leave out the
   * bonuses Fantrax counts). Default 1 (season 0 only).
   */
  base0Through?: number;
  /**
   * Expected season gain at a salary, from the dynasty simulation's career
   * paths (phase, aging, retirement, role, injuries); replaces
   * max(0, value − charge) on the expected value when given.
   */
  gainAt?: (t: number, salary: number) => number;
}

export interface ContractOption {
  years: number;
  /** Best extension length after it (0 = let him walk). */
  ext: number;
  /** Discounted surplus, league points. */
  total: number;
}

export interface ContractPlan {
  start: number;
  years: number;
  base: number;
  ext: number;
  /** Base of the extension (his NHL cap hit when it starts), null without one. */
  extBase: number | null;
  /** First season index after control (contract + extension): he is a free agent from it. */
  end: number;
  /** League salary per season (0 before the start and after control), M$. */
  salary: number[];
  /** Season gain under this plan, league points: max(0, value − charge) while held. */
  gain: number[];
  /** Discounted surplus. */
  total: number;
  /** Every first-contract length (1..maxYears) with its best extension. */
  options: ContractOption[];
  fixed: boolean;
}

/** One season's gain at a salary: play him (value − charge) or stash him in the minors (0). */
export function seasonGain(value: number, salary: number, lambda: number, min: number): number {
  return Math.max(0, value - lambda * Math.max(0, salary - min));
}

/** Highest salary worth paying for a season of this value (the break-even), M$. */
export function breakEvenSalary(value: number, lambda: number, min: number): number {
  if (!(value > 0)) return 0;
  return lambda > 0 ? min + value / lambda : Infinity;
}

/**
 * Base of a contract (or extension) starting in season t: his NHL cap hit
 * then (at least the league minimum); during his current signed contract
 * whose league salary is known (base0, Fantrax), at least that salary —
 * exactly it in season 0. Audit 2026-10-02 (CAP-7): an extension starting
 * inside an entry-level deal took capwages' 0.97 M$ (no bonuses) against a
 * first contract at Fantrax's 1.9-4.3 M$, and the planner advised « 1-2
 * years + 7-year extension » for six such players on that artefact alone.
 */
export function contractBaseAt(
  inp: Pick<ContractPlanInput, "nhl" | "min" | "base0" | "base0Through">,
  t: number,
): number {
  const b0 = inp.base0 && inp.base0 > 0 ? inp.base0 : null;
  if (b0 != null && t === 0) return r2(b0);
  const nhl = Math.max(inp.nhl[t] ?? 0, inp.min[t] ?? 0);
  if (b0 != null && t < (inp.base0Through ?? 1)) return r2(Math.max(nhl, b0));
  return r2(nhl);
}
const baseAt = contractBaseAt;

/** A surplus within max(0.5 pt, 1 %) of the best counts as a tie (the simulation's noise and the model's precision). */
export function contractTie(best: number): number {
  return Math.max(0.5, 0.01 * Math.abs(best));
}

/**
 * The recommended first-contract length among `options` ([surplus, best
 * extension] for lengths 1..n): the shortest total control (length +
 * extension) whose surplus is within `contractTie` of the best, then the
 * larger surplus, then the shorter first contract. Audit 2026-10-02
 * (CAP-2): minors stashing is free in the objective, so long controls cost
 * almost nothing and the strict maximum fell among ~18 near-ties, often a
 * 7-year extension running to 40+.
 */
export function recommendedLength(options: ReadonlyArray<readonly [number, number]>): number {
  if (!options.length) return 1;
  const best = Math.max(...options.map((o) => o[0]));
  const tol = contractTie(best);
  let pick = -1;
  options.forEach(([total, ext], j) => {
    if (total < best - tol - 1e-9) return;
    if (pick < 0) {
      pick = j;
      return;
    }
    const [pt, pe] = options[pick]!;
    const ctl = j + 1 + ext;
    const pctl = pick + 1 + pe;
    if (ctl < pctl || (ctl === pctl && total > pt + 1e-9)) pick = j;
  });
  return Math.max(1, pick + 1);
}

/** Lengths whose surplus is within `contractTie` of the best (the « Plafond » tab's equivalent choices). */
export function equivalentLengths(options: ReadonlyArray<readonly [number, number]>): number[] {
  if (!options.length) return [];
  const best = Math.max(...options.map((o) => o[0]));
  const tol = contractTie(best);
  return options.flatMap(([total], j) => (total >= best - tol - 1e-9 ? [j + 1] : []));
}

/** Salary path and gains of one (first contract, extension) choice. */
function evaluate(inp: ContractPlanInput, T: number, years: number, ext: number, base: number, rules: LeagueContractRules) {
  const salary = new Array<number>(T).fill(0);
  const gain = new Array<number>(T).fill(0);
  // before the first contract (a prospect without an NHL contract): minors, no cap
  for (let t = 0; t < Math.min(T, inp.start); t++) gain[t] = inp.gainAt ? inp.gainAt(t, 0) : Math.max(0, inp.value[t] ?? 0);
  const first = contractSalaries(base, years, rules);
  let t = inp.start;
  for (const s of first) {
    if (t >= T) break;
    salary[t] = s;
    t++;
  }
  const extStart = inp.start + years;
  const extBase = ext > 0 ? baseAt(inp, Math.min(extStart, T - 1)) : null;
  if (ext > 0) {
    for (const s of contractSalaries(extBase!, ext, rules)) {
      if (t >= T) break;
      salary[t] = s;
      t++;
    }
  }
  const end = inp.start + years + ext;
  let total = 0;
  for (let u = inp.start; u < Math.min(T, end); u++) {
    gain[u] = inp.gainAt ? inp.gainAt(u, salary[u]!) : seasonGain(inp.value[u] ?? 0, salary[u]!, inp.lambda[u] ?? 0, inp.min[u] ?? 0);
  }
  for (let u = 0; u < T; u++) total += Math.pow(inp.delta, u) * gain[u]!;
  return { salary, gain, total, extBase, end };
}

/**
 * The best league contract for a player: the first-contract length (or the
 * confirmed one) and the extension, by discounted surplus. Near-ties
 * (`contractTie`) go to the shorter total control: for each length the
 * shortest extension within the tie of that length's best, then
 * `recommendedLength` over the lengths.
 */
export function planContract(inp: ContractPlanInput, rules: LeagueContractRules = SLAPSHOT_CONTRACT_RULES): ContractPlan {
  const T = inp.value.length;
  const base = inp.fixed?.base != null ? r2(inp.fixed.base) : baseAt(inp, Math.min(inp.start, T - 1));
  const exts = inp.extended || rules.extensions < 1 ? [0] : Array.from({ length: rules.maxYears + 1 }, (_, j) => j);
  const lengths = Array.from({ length: rules.maxYears }, (_, j) => j + 1);
  const options: ContractOption[] = [];
  for (const years of lengths) {
    const totals = exts.map((ext) => evaluate(inp, T, years, ext, base, rules).total);
    const rowBest = Math.max(...totals);
    const tol = contractTie(rowBest);
    const k = totals.findIndex((x) => x >= rowBest - tol - 1e-9);
    options.push({ years, ext: exts[k]!, total: Math.round(totals[k]! * 10) / 10 });
  }
  let best: { years: number; ext: number };
  const fixedYears = inp.fixed ? Math.floor(inp.fixed.years) : null;
  if (fixedYears != null) {
    // a confirmed length (outside 1..maxYears: as given, no extension)
    const o = options.find((x) => x.years === fixedYears);
    best = o ? { years: o.years, ext: o.ext } : { years: Math.max(1, fixedYears), ext: 0 };
  } else {
    const years = recommendedLength(options.map((o) => [o.total, o.ext] as const));
    best = { years, ext: options[years - 1]!.ext };
  }
  const ev = evaluate(inp, T, best.years, best.ext, base, rules);
  return {
    start: inp.start,
    years: best.years,
    base,
    ext: best.ext,
    extBase: ev.extBase,
    end: ev.end,
    salary: ev.salary,
    gain: ev.gain.map((g) => Math.round(g * 10) / 10),
    total: Math.round(ev.total * 10) / 10,
    options,
    fixed: !!inp.fixed,
  };
}

/** A chosen (years, extension) evaluated as is — the « Plafond » tab's what-if. */
export function evaluateContract(
  inp: ContractPlanInput,
  years: number,
  ext: number,
  rules: LeagueContractRules = SLAPSHOT_CONTRACT_RULES,
): Pick<ContractPlan, "salary" | "gain" | "total" | "extBase" | "end" | "base"> {
  const T = inp.value.length;
  const base = inp.fixed?.base != null ? r2(inp.fixed.base) : baseAt(inp, Math.min(inp.start, T - 1));
  const ev = evaluate(inp, T, years, inp.extended ? 0 : ext, base, rules);
  return { ...ev, base, total: Math.round(ev.total * 10) / 10 };
}

/**
 * Salary per season of a (first contract, extension) choice: 0 before the
 * start and after control. The extension's base is his NHL cap hit (at least
 * the league minimum) of its first season. Shared by the build and the
 * « Plafond » tab.
 */
export function salarySchedule(
  start: number,
  base: number,
  years: number,
  ext: number,
  nhl: readonly number[],
  min: readonly number[],
  T: number,
  rules: LeagueContractRules = SLAPSHOT_CONTRACT_RULES,
  /** His league salary now and the seasons of his current signed contract (`contractBaseAt`). */
  now: { base0?: number | null; base0Through?: number } = {},
): { salary: number[]; extBase: number | null; end: number } {
  const salary = new Array<number>(T).fill(0);
  let t = start;
  for (const s of contractSalaries(base, years, rules)) {
    if (t >= T) break;
    salary[t++] = s;
  }
  const e = start + years;
  const extBase = ext > 0 ? contractBaseAt({ nhl, min, ...now }, Math.min(e, T - 1)) : null;
  if (ext > 0) {
    for (const s of contractSalaries(extBase!, ext, rules)) {
      if (t >= T) break;
      salary[t++] = s;
    }
  }
  return { salary, extBase, end: start + years + ext };
}

/**
 * Every salary a season can carry over all (first contract, extension)
 * choices, 0 included: what the simulation averages its season gains at.
 */
export function contractLevels(
  inp: Pick<ContractPlanInput, "start" | "nhl" | "min" | "fixed" | "extended" | "base0" | "base0Through">,
  T: number,
  rules: LeagueContractRules = SLAPSHOT_CONTRACT_RULES,
): number[][] {
  const base = inp.fixed?.base != null ? r2(inp.fixed.base) : baseAt(inp, Math.min(inp.start, T - 1));
  const sets = Array.from({ length: T }, () => new Set<number>([0]));
  const lengths = inp.fixed ? [Math.floor(inp.fixed.years)] : Array.from({ length: rules.maxYears }, (_, j) => j + 1);
  const exts = inp.extended || rules.extensions < 1 ? [0] : Array.from({ length: rules.maxYears + 1 }, (_, j) => j);
  const now = { base0: inp.base0 ?? null, ...(inp.base0Through != null ? { base0Through: inp.base0Through } : {}) };
  for (const y of lengths) {
    for (const e of exts) {
      const { salary } = salarySchedule(inp.start, base, y, e, inp.nhl, inp.min, T, rules, now);
      salary.forEach((s, t) => sets[t]!.add(s));
    }
  }
  return sets.map((s) => [...s].sort((a, b) => a - b));
}

/** A gain function from the simulation's averages at those levels (nearest level; 0 outside). */
export function gainFromLevels(levels: readonly (readonly number[])[], sums: readonly (readonly number[])[], n: number): (t: number, salary: number) => number {
  return (t, salary) => {
    const lv = levels[t];
    const sm = sums[t];
    if (!lv || !sm || !(n > 0)) return 0;
    let j = 0;
    let best = Infinity;
    for (let k = 0; k < lv.length; k++) {
      const d = Math.abs(lv[k]! - salary);
      if (d < best) {
        best = d;
        j = k;
      }
    }
    return sm[j]! / n;
  };
}

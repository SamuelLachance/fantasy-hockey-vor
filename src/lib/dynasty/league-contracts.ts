/**
 * Slapshot league contracts (SFHL rulebook §2.3-2.4, owner answers of
 * 2026-10-02). Every player signs a league contract of 1 to 7 seasons whose
 * base (year 1) is his real NHL cap hit of the signing season; later years
 * rise relative to that base (year 2-3 +10 %, years 4-6 +15 %, year 7 +20 %).
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
 * cap's shadow price (league points per M$), from the dynasty build.
 *
 * Pure: used by the dynasty build and by the browser's « Plafond » tab.
 */

export interface LeagueContractRules {
  /** Salary multiplier of contract year 1..maxYears, relative to the base. */
  mult: readonly number[];
  maxYears: number;
  /** Extensions a contract may get (1). */
  extensions: number;
  /** League cap and floor per season, M$ (fixed). */
  cap: number;
  floor: number;
}

export const SLAPSHOT_CONTRACT_RULES: LeagueContractRules = {
  mult: [1, 1.1, 1.1, 1.15, 1.15, 1.15, 1.2],
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

function baseAt(inp: ContractPlanInput, t: number): number {
  return r2(Math.max(inp.nhl[t] ?? 0, inp.min[t] ?? 0));
}

/** Salary path and gains of one (first contract, extension) choice. */
function evaluate(inp: ContractPlanInput, T: number, years: number, ext: number, base: number, rules: LeagueContractRules) {
  const salary = new Array<number>(T).fill(0);
  const gain = new Array<number>(T).fill(0);
  // before the first contract (a prospect without an NHL contract): minors, no cap
  for (let t = 0; t < Math.min(T, inp.start); t++) gain[t] = Math.max(0, inp.value[t] ?? 0);
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
    gain[u] = seasonGain(inp.value[u] ?? 0, salary[u]!, inp.lambda[u] ?? 0, inp.min[u] ?? 0);
  }
  for (let u = 0; u < T; u++) total += Math.pow(inp.delta, u) * gain[u]!;
  return { salary, gain, total, extBase, end };
}

/**
 * The best league contract for a player: the first-contract length (or the
 * confirmed one) and the extension, by discounted surplus. Ties go to the
 * shorter commitment.
 */
export function planContract(inp: ContractPlanInput, rules: LeagueContractRules = SLAPSHOT_CONTRACT_RULES): ContractPlan {
  const T = inp.value.length;
  const base = inp.fixed?.base != null ? r2(inp.fixed.base) : baseAt(inp, Math.min(inp.start, T - 1));
  const exts = inp.extended || rules.extensions < 1 ? [0] : Array.from({ length: rules.maxYears + 1 }, (_, j) => j);
  const lengths = Array.from({ length: rules.maxYears }, (_, j) => j + 1);
  const options: ContractOption[] = [];
  let best: { years: number; ext: number; total: number } | null = null;
  for (const years of lengths) {
    let bestExt = 0;
    let bestTotal = -Infinity;
    for (const ext of exts) {
      const { total } = evaluate(inp, T, years, ext, base, rules);
      if (total > bestTotal + 1e-9) {
        bestTotal = total;
        bestExt = ext;
      }
    }
    options.push({ years, ext: bestExt, total: Math.round(bestTotal * 10) / 10 });
    const allowed = inp.fixed ? years === Math.floor(inp.fixed.years) : true;
    if (allowed && (!best || bestTotal > best.total + 1e-9)) best = { years, ext: bestExt, total: bestTotal };
  }
  if (!best) {
    // a confirmed length outside 1..maxYears: keep it as given, no extension
    const years = Math.max(1, Math.floor(inp.fixed?.years ?? 1));
    best = { years, ext: 0, total: evaluate(inp, T, years, 0, base, rules).total };
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

/**
 * Dynasty value (Captains Dynasty League, Fantrax): shared types.
 *
 * DV is the expected discounted sum, over 12 seasons (2026-27 … 2037-38), of
 * a player's season gain on a generic 16-team roster: realized fantasy
 * points above the waiver line, plus the captain premium, minus the
 * keeper-slot cost K in seasons he is kept although no longer
 * minors-eligible, floored at 0 in-season and 0 forever once released.
 *
 * Unit: "points de dynastie" (realized FP above replacement). It is NOT on
 * the projected scale shown elsewhere on /league; never add the two.
 */

export type Mode = "winNow" | "balanced" | "longTerm";
export const MODES: readonly Mode[] = ["winNow", "balanced", "longTerm"];

export type Group = "F" | "D" | "G";

export type Phase =
  | "prospect"
  | "rising"
  | "entering_prime"
  | "prime"
  | "plateau"
  | "declining"
  | "late_career";

export type PathKind = "nhl" | "prospect" | "fringe";

/** Market segment (§3.2): which crowd signal, if any, may move the value. */
export type MarketSeg =
  | "young_nhl"
  | "established"
  | "veteran"
  | "late"
  | "G_est"
  | "G_young"
  | "G_prospect"
  | "prospect"
  | "prospect_nhl"
  | "prospect_slot"
  | "fringe";

export type DynastyFlag =
  | "placeholderProjection"
  /** Young skater: his 2025-26 FP/G and the projection disagree by more than 25% (≥ 20 GP). */
  | "projectionConflict"
  | "noModel"
  | "eligibilityUncertain"
  | "startShareNews"
  /** A current IR / injury / suspension status trims 2026-27 (not later seasons). */
  | "injuredNow";

export type KeeperStatus = "free" | "core" | "bubble" | "rental";

/** A frozen research prospect record (src/data/dynasty/prospects.json). */
export interface ProspectRecord {
  nhlId?: number;
  n: string;
  pos: Group;
  birthDate?: string;
  draft?: { year: number; pick: number };
  nhlGP: number;
  /** P(200 NHL GP), or one 40-start season for goalies. */
  pMake: number;
  pSource: string;
  /** Prime (age 25) FP/G if he makes it, realized scale (goalies: per start). */
  fpgIfMake: { mu: number; sd: number };
  /** First regular season (start year) if he makes it. */
  eta: number;
  comp: { fpDraft?: number; fpNhle?: number; fpSnake?: number };
}

export interface ProspectsFile {
  builtAt: string;
  source: string;
  players: Record<string, ProspectRecord>;
  /** Birth dates for players with neither a profile nor a prospect record. */
  birthDates?: Record<string, string>;
}

/** One NHL regular season of a player (aggregated over teams). */
export interface SeasonLine {
  /** Start year, e.g. 2025 for 2025-26. */
  season: number;
  gp: number;
  /** Seconds per game; null when unknown. */
  toi: number | null;
  goals: number;
  assists: number;
  shots: number;
  hits: number;
  blocks: number;
  takeaways: number;
}

/**
 * One player as the build script assembles him from the synced files (all
 * ids already joined). Everything the model needs, nothing it must fetch.
 */
export interface DynastyInput {
  /** Fantrax id. */
  id: string;
  n: string;
  /** Fantrax eligiblePos ("W,C,F,Skt", "D,Skt", "G"); "" when unknown. */
  e: string;
  /** NHL team abbreviation (for the share of the season left), or null. */
  team: string | null;
  nhlId?: number;
  birthDate: string | null;
  /** Fantrax integer age (fallback when the birth date is unknown). */
  fantraxAge?: number;
  /**
   * Career NHL games before the current season (goalies: appearances); null
   * when unknown. Games of the season in progress go in `seasonGp`.
   */
  careerGp: number | null;
  /** NHL games already played this season (Fantrax season-to-date GP; 0 before opening night). */
  seasonGp?: number;
  /** Fantrax status icons now (injury / IR / suspension trim season 0). */
  status?: string[];
  /** values.json projection (per-game FP on the projected scale). */
  proj?: {
    src: "proj" | "prior";
    gp: number;
    off?: number;
    dx?: number;
    gE?: number;
    /**
     * Goalie depth-chart start share within his NHL club (injured and
     * suspended goalies kept in; minors / unsigned / inactive goalies out).
     */
    pS?: number;
    /** players.json projectionMethod; null when not matched. */
    method: "ml" | "contextual" | null;
  };
  prospect?: ProspectRecord;
  /** NHL entry draft (profile first, then the registry). */
  draft?: { year: number; pick: number };
  /** Where `draft` comes from: an id-keyed profile, or a name match in the registry. */
  draftSource?: "profile" | "registry";
  /** Fantrax minors-eligible icon now; null = unknown (rule-based). */
  eligNow: boolean | null;
  /** Regular seasons, most recent last (trajectory modifier). */
  history?: SeasonLine[];
  /** Position hint when `e` is empty (prospect records). */
  posHint?: Group;
  ros?: number;
  adp?: number;
  leaguePick?: number;
  rostered: boolean;
}

export interface DynastyBuildInputs {
  players: DynastyInput[];
  meta: {
    valuesFetchedAt: string;
    stateFetchedAt: string;
    projectionsAt: string;
    prospectsBuiltAt: string;
    poolFetchedAt?: string | null;
  };
  /** Share of each NHL team's regular season still to play (1 before opening night). */
  remainingShare?: Record<string, number>;
  /**
   * The league's rosters and the rest of the live draft (team of each
   * remaining pick, in order), for the team-conditional keeper odds. Team
   * ids stay in the build: nothing about owners reaches dynasty.json.
   */
  league?: { rosters: Record<string, string[]>; remainingPicks: string[] };
}

export interface DynastyRecord {
  n: string;
  g: Group;
  /** Age on Oct 1 2026, 1 dp. */
  age: number;
  nhlId?: number;
  path: PathKind;
  seg: MarketSeg;
  phase: Phase;
  effAge: number;
  traj: -1 | 0 | 1;
  /** Career NHL GP now (goalies: appearances). */
  gp: number;
  draft?: { year: number; pick: number };
  /** Posterior value per mode, 1 dp. */
  dv: Record<Mode, number>;
  /** Model value before the market layer (only when the market moved it). */
  dvModel?: Record<Mode, number>;
  rank: Record<Mode, number>;
  /** P10 / P50 / P90 of the per-path discounted sums. */
  band: { balanced: [number, number, number]; longTerm: [number, number, number] };
  /** Expected season gain, 12 seasons, posterior-scaled (balanced), 1 dp. */
  eG: number[];
  /** Median season gain, 12 seasons, integers. */
  p50G: number[];
  /**
   * Expected realized FP, 12 seasons, integers (reports only). Season 0 is
   * the part of 2026-27 still to play.
   */
  eFP: number[];
  /**
   * The model's expected yearly change of the per-game level over the next
   * two seasons (conditional growth for young skaters, else λ-scaled aging
   * with the elite / trajectory shift), 3 dp; null off the NHL path.
   * Independent of games played and of how much of the season is left.
   */
  trend?: number | null;
  /**
   * Conditional growth driver (NHL-path skaters whose 2025-26 season was at
   * 18–23). The base is the 2025-26 level (its FP/G blended with the
   * projection, w = GP / (GP + 36)) and m = G_1 … G_6 are the expected FP/G
   * of 2026-27 … 2031-32 relative to it; src "projection" when he played
   * under 30 GP in 2025-26 (the base leans on the projection). Base age,
   * production percentile among same-age NHL seasons and draft pick, 3 dp.
   */
  growth?: { src: "season" | "projection"; base: number; baseAge: number; pct: number; pick: number | null; m: number[] };
  pNhl: number;
  /** Median first NHL season (start year) for the prospect path; null otherwise. */
  eta: number | null;
  elig: {
    now: boolean;
    /** P(eligible at the 2027 cutdown). */
    next: number;
    /** Last season (start year) he is more likely than not eligible; null if not now. */
    freeThrough: number | null;
    binding: "age" | "gp" | null;
    uncertain: boolean;
  };
  /**
   * status / pKept27: league-wide (the 160th keeper; the value basis, as on a
   * generic roster). team (rostered players): against his own team's 10
   * keeper slots at the 2027 cutdown — the roster view; rank = median rank
   * among his team's candidates (the rest of the draft filled by market rank).
   */
  keeper: {
    status: KeeperStatus;
    pKept27: number | null;
    team?: { status: KeeperStatus; pKept27: number | null; rank: number | null };
  };
  market: {
    ros?: number;
    adp?: number;
    leaguePick?: number;
    rank?: number;
    dvMkt?: number;
    w: number;
    gap?: number;
  };
  flags?: DynastyFlag[];
}

export interface DynastySnapshot {
  builtAt: string;
  season: "2026-27";
  version: 1;
  inputs: {
    valuesFetchedAt: string;
    stateFetchedAt: string;
    projectionsAt: string;
    prospectsBuiltAt: string;
    poolFetchedAt: string | null;
    paramsVersion: string;
    /** Current-season NHL games added to the career totals (0 before opening night). */
    ytdGames?: number;
  };
  params: {
    T: number;
    paths: number;
    /** NHL regular-season length used for games (84 from 2026-27). */
    seasonGames?: number;
    lambda: number;
    deltaKeep: number;
    scale: { F: { a: number; b: number }; D: { a: number; b: number } };
    repl: { F: number; D: number; Gseason: number };
    offRef: number;
    /**
     * Keeper slot: `value` is the cost charged per kept non-eligible season
     * (160th largest E[V_1]); `gate` is the keep-index threshold at a cutdown
     * (the 160th largest keep index per simulated league, averaged), the same
     * marginal keeper in keep-index units.
     */
    K: { value: number; band: [number, number]; rank: number; gate?: number; gateBand?: [number, number] };
    /** DV = Σ_t w_t δ^t eG_t with w_0 = w0, w_1 = w1 (1 when absent), w_t = 1 after. */
    modes: Record<Mode, { delta: number; w0: number; w1?: number }>;
    cutdown: { month: number; day: number; window: [string, string] };
    market: { enabled: boolean; weights: Record<string, number> };
  };
  players: Record<string, DynastyRecord>;
  /** Sanity diagnostics (check:league). */
  diag?: {
    /**
     * Per NHL team: summed year-0 depth-chart starts of its modeled goalies
     * (before injuries), and the reference they must reach — the projected
     * GP of those not sent down / unsigned / inactive, capped at a season.
     */
    goalieStarts0: Record<string, { starts: number; ref: number }>;
    /** Expected number of non-eligible players kept at the 2027, 2028 and 2029 cutdowns (target 160). */
    keptPerCutdown?: number[];
  };
  /**
   * values.json players that were modeled but left out to keep the file
   * small: unrostered, long-term value below params.output.minLongTerm
   * (read their value as 0 in every mode).
   */
  zero: string[];
}

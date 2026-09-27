/**
 * Fantrax league settings, one entry per league, keyed by the registry slug
 * (`src/lib/leagues/registry.ts`). Nothing here reads the network or `fs`,
 * and nothing imports the registry: this module is the leaf both the client
 * bundle and the scripts pull in.
 *
 * A Fantrax league differs from another in more than its id: the slot table
 * (Captains has a captain slot and one flex F; another league may split
 * LW/RW), which `eligiblePos` token fills which slot, whether Fantrax's
 * per-slot zero rows are published in `scoringCategorySettings` or only in
 * `scoringCategories`, the matchup cadence, the roster limits, and which
 * features exist at all (captain, minors, GP/GS caps, dynasty keepers).
 * Everything a script or the engine needs to vary lives in the config, so
 * adding a league is data, not code.
 *
 * Slot counts and roster limits mirror `getLeagueInfo.rosterInfo` and the
 * public rules page; the sync re-reads what fxea exposes into the league's
 * own league.json each run, so the values here are the fallback and the
 * test fixture. Limits fxea does NOT expose (minTotal, maxIr, maxMinors,
 * healthyIrGracePeriods) come from the league's rules page and must never
 * be inherited from another league.
 *
 * The legacy `FANTRAX_*` / `SLOT_ORDER` / `DEFAULT_*` exports below are the
 * Captains Dynasty entry's fields, unchanged, so every existing importer
 * keeps the same values.
 */

/** A Fantrax lineup slot, across every league in the registry. */
export type SlotId = "C" | "LW" | "RW" | "W" | "F" | "D" | "Skt" | "G";

/**
 * Coarse groups the player pool, the draft board, the position filter and the
 * VONA model rank by. Each league declares its OWN list
 * (`eligibility.groups`), because a group is what the tool can be asked for:
 * Captains, whose lineup has one W slot plus a flex F, ranks centres, wingers,
 * defence and goalies; Slapshot, whose lineup has four LW seats and four RW
 * seats, ranks the two wings apart, so « 4 postes RW vides » can be answered
 * with a list of right wingers.
 *
 * Splitting the wings costs the VOR model nothing, which is why it is safe: an
 * optimal league-wide fill equalises the two wings' replacement levels to
 * within ~2% (Slapshot 2026-09-27: LW 65.6 vs RW 64.5 season points), so
 * measuring them apart moves no player by more than a rank or two. What it
 * buys is that the wing a player can actually fill is the wing he is listed
 * under.
 *
 * `FANTRAX_GROUPS` is the vocabulary ACROSS leagues, in display order: it is
 * what `?pos=` in a URL is parsed against and the set a pool file's `pos`
 * string may spell. Iterating it is never right — iterate the league's own
 * `eligibility.groups`.
 */
export type FantraxGroup = "C" | "LW" | "RW" | "W" | "D" | "G";
export const FANTRAX_GROUPS: readonly FantraxGroup[] = ["C", "LW", "RW", "W", "D", "G"];

/** Active slots per lineup. Partial: a league only lists the slots it has. */
export type SlotCounts = Partial<Record<SlotId, number>>;

export interface FantraxSlotTable {
  /** Render and optimizer order (matches the league's Fantrax roster page). */
  order: readonly SlotId[];
  counts: SlotCounts;
}

/**
 * How a Fantrax `eligiblePos` string ("W,C,F,Skt", "LW,RW") maps onto this
 * league's slots and onto the value model's skater / goalie / D questions.
 */
export interface FantraxEligibility {
  /**
   * `eligiblePos` tokens that fill a slot, for slots whose token is not its
   * own name (a league whose single W slot takes LW and RW, say). Slots left
   * out are filled by their own name, which is how Fantrax spells them.
   */
  slotTokens: Partial<Record<SlotId, readonly string[]>>;
  /** Tokens that make a player a skater; a player with none of them (and G) is a goalie. */
  skaterTokens: readonly string[];
  /** Tokens that make a player defense-eligible (he can earn the D-slot extras). */
  defenseTokens: readonly string[];
  /** Token Fantrax uses for a goalie. */
  goalieToken: string;
  /**
   * This league's groups, in display order: the position filter's chips, the
   * pool's `pos` string, the VONA panel's cards. A subset of
   * `FANTRAX_GROUPS`, and no group may be a substring of another (the pool's
   * `pos` concatenates them: "CLW" is C + LW).
   */
  groups: readonly FantraxGroup[];
  /**
   * `eligiblePos` tokens that put a player in each of `groups`. Captains
   * spells its groups exactly ("C", "W", "D", "G"); Slapshot spells the wings
   * by side. A token in no group would drop the player from the pool and from
   * every VONA group, so the config must cover all of them (`check:league`
   * proves it against the league's own player universe).
   */
  groupTokens: Partial<Record<FantraxGroup, readonly string[]>>;
}

/**
 * Which fxea structure the scoring table is read from.
 * - "settings": `scoringSystem.scoringCategorySettings`, the typed list.
 *   It OMITS every row worth 0, so a league that configures a category to 0
 *   for each of its slots looks like it never configured it at all.
 * - "categories": `scoringSystem.scoringCategories`, the `"points0.3"` map.
 *   Complete, zeros included — the only correct source for a league whose
 *   per-slot zeros carry meaning.
 * Captains stays on "settings": its zero rows are redundant there (Blk / Tk /
 * skater SHO fall back to 0 anyway), and switching it would add `Default: 0`
 * rows to the committed league.json.
 */
export type ScoringSource = "settings" | "categories";

/**
 * Slot the stored `off` (a skater's per-game offense) is measured in, i.e.
 * which column of the scoring table a plain forward scores by.
 *
 * Fantrax scores `pts(cat, slot) = cfg[cat][slot] ?? cfg[cat].Default`, so
 * "Default" is right only for a league that publishes no row for its own
 * forward slots — Captains, where Blk / Tk / skater SHO list `D` alone and
 * every other slot falls through.
 *
 * Slapshot publishes an explicit `points0` for EACH of its five slots
 * (C / LW / RW / D / G) on Hit and SB while `Default` holds 0.15 / 0.3, so
 * `Default` is a row no slot can reach and reading it would credit hits and
 * blocked shots that no lineup ever scores (Seider 242 vs 183 season points,
 * a 74-rank swing).
 *
 * THE OTHER READING, if week-1 scoring shows Fantrax really does pay those
 * 0.15 / 0.3, is that Fantrax ignores the per-slot rows altogether. That is
 * NOT `baseSlot: "Default"` on its own: the D column publishes the same zeros,
 * so `off` would then pay hits and blocks while `dx` subtracted them again
 * (measured on a Seider-shaped line: off 3.2340, dx −0.8289), `unmodeledSlots`
 * would fail C / LW / RW against an unreachable base, and `deadCategories`
 * would still call Hit and SB dead. The switch that expresses it is the pair
 *   scoringSource: "settings",  baseSlot: "Default"
 * — "settings" omits every row worth 0, so the per-slot zeros disappear and
 * EVERY slot reads 0.15 / 0.3, D included (dx then 0). It needs one re-sync
 * (`npm run league:sync -- --league slapshot`) for league.json to be re-read
 * that way; `check:league` fails until then, naming the mismatch.
 * `scripts/test-fantrax-config.ts` pins both readings side by side.
 */
export type ScoringBaseSlot = SlotId | "Default";

/**
 * How a defenseman in the Skt (captain) slot scores Blk / Tk / skater SHO.
 * "default": the Skt config has no rows for them, so Fantrax falls back to
 * Default = 0 (live 2025-26 scores: Hutson Blk:3 = 0; the 2026-09-27 fxpa
 * read of Porter Martone in a W slot confirms the fallback to the centime).
 * "d": he keeps his D-slot values. Flip here if week-1 scoring disagrees.
 */
export type DInSktFallback = "default" | "d";

/** Matchup and lineup cadence. Asserted against league.json by check:league. */
export interface FantraxCadence {
  /** Scoring periods (matchups) in the season, playoffs included. */
  scoringPeriods: number;
  /** Lineup periods; daily in every league seen so far. */
  rosterPeriods: number;
  /** Nominal days per scoring period (7 = a weekly matchup, 2 = four a week). */
  scoringPeriodDays: number;
  /**
   * Shortest and longest scoring period in days when the league's periods are
   * custom (Slapshot: 84 periods of 1 to 4 days); absent = all nominal.
   */
  scoringPeriodDaysRange?: readonly [number, number];
  /**
   * Lineup lock: "period" = the whole lineup locks at the start of the lineup
   * period (Captains' daily lock); "game" = each player locks
   * `minutesBefore` minutes before his own game (Slapshot: 5).
   */
  lock?: { kind: "period" | "game"; minutesBefore: number };
  /**
   * Share of the NHL regular season inside the league's fantasy regular
   * season, which season totals are projected over. Absent = all of it.
   * Slapshot's periods 1-82 end on 2027-02-25: 1,003 of the 1,344 NHL games
   * start before then (0.746, the dynasty profile's `season.fantasyShare`).
   */
  seasonShare?: number;
  /** Live draft: how often the browser re-reads the picks while the draft runs (ms). */
  draftPollMs?: number;
  /**
   * Weekday the FA/WW claim counter resets on (1 = Monday, Eastern), or null
   * when the league has no weekly reset (or it could not be confirmed).
   */
  claimWeekStartsOn: number | null;
}

/**
 * Fallback per-game values for a player this repo has no projection for
 * (2026 draftees, unmatched prospects, veterans abroad). They are POINTS in
 * this league's own scoring, so they cannot be shared between leagues: the
 * same player is worth 2.52 FP/G on Captains' scale and a different number on
 * Slapshot's, whose skater categories and their weights are not the same.
 *
 * Each one is a p25-of-a-regular quantity in the league's own scoring, and the
 * goalie number is the expected points per start of the goalie on the last
 * starting seat. `npm run league:report -- --league <slug> --priors` re-measures
 * all three from the committed snapshot beside what is stored here.
 *
 * The two leagues' numbers were measured on different populations, so the
 * report's diff is only meaningful within a league: Captains' come from the
 * REALIZED 2025-26 regulars, Slapshot's from the PROJECTED 2026-27 pool (it has
 * no history of its own — first season). Each entry says which.
 */
export interface FantraxPriors {
  /** p25 FP/G of forwards, and of defencemen (D carry their slot extras). */
  fpg: { F: number; D: number };
  /** Expected points per start of the marginal starting goalie. */
  goalieE: number;
  /** P(an unprojected skater dresses) on a night his club plays. */
  pPlay: number;
  /**
   * FP/G at which a low-GP projection reads as injury risk rather than a
   * scratch (see `skaterPlayProbability`). Same p25-of-regulars quantity as
   * `fpg.F`, so it too is in this league's points.
   */
  regularMinFpg: number;
}

export interface RosterLimits {
  /** Active + Reserve must reach this or the whole lineup period scores 0. */
  minTotal: number;
  maxActive: number;
  maxReserve: number;
  maxIr: number;
  maxMinors: number;
  /** A healthy player left on IR makes the roster illegal after this many lineup periods. */
  healthyIrGracePeriods: number;
  /**
   * Most players on the roster, IR excluded (Active + Reserve + Minors), when
   * the league publishes one (Slapshot: 40 = 20 + 3 + 17). Absent: no total
   * cap is checked (Captains' has never been read).
   */
  maxTotal?: number;
}

/**
 * Features a league either has or has not. Each one gates a whole slice of
 * the tool: a league without them must not be shown the Captains answer.
 */
export interface FantraxFeatures {
  /** A captain (Skt) slot multiplies one starter's offense. */
  captainSlot: boolean;
  /** Minors slots exist (and Fantrax's minors-eligible flag means something). */
  minors: boolean;
  /** Per-scoring-period GP / GS caps exist and are read from fxpa. */
  gamesCaps: boolean;
  /** Keep-forever league: the dynasty model (src/lib/dynasty) applies. */
  dynasty: boolean;
  /**
   * The Captains cutdown: 10 protected players a team each September plus a
   * free Minors stash for the minors-eligible (`elig`, `keeper` in
   * dynasty.json). Everything about « écrémage », « protégés » and minors
   * eligibility is gated on it: a dynasty league where every player carries
   * over and anyone may sit in the minors (Slapshot) has none of it.
   */
  keeperCutdown: boolean;
  /**
   * ANY player may be sent to the Minors slots (no eligibility rule): every
   * rostered player can make room there, not only Fantrax's minors-eligible.
   */
  minorsAnyPlayer: boolean;
  /** fxpa answers unauthenticated for this league (icons, Ros%, caps, claims). */
  fxpa: boolean;
  /** FA + WW claims per week, or null when the league has no known limit. */
  claimsPerWeek: number | null;
}

/**
 * Where a league's files live. Repo-relative POSIX paths: `config.ts` stays
 * free of `path` so the client bundle can import it (see
 * `scripts/fantrax-paths.ts` for the Node side, `fantraxPublicFile` for the
 * browser side).
 *
 * Captains keeps the flat, historical layout (`src/data/fantrax/league.json`,
 * `public/fantrax/values.json`): those published files are fetched at runtime
 * by pages already open in a browser and by cached bundles, and GitHub Pages
 * deploys are not atomic, so moving them would break live sessions and
 * rewrite bytes that are otherwise provably untouched. Every other league
 * gets its own `<slug>/` subdirectory.
 */
export interface FantraxPathConfig {
  /** Committed inputs, e.g. "src/data/fantrax" or "src/data/fantrax/<slug>". */
  data: string;
  /** Published files, e.g. "public/fantrax" or "public/fantrax/<slug>". */
  public: string;
  /** Prefix of a published file inside `/fantrax/` for the browser ("" = at the root). */
  href: string;
}

export interface FantraxLeagueConfig {
  /** Registry slug (`LEAGUES[].slug`): the key of this table. */
  slug: string;
  leagueId: string;
  /** The user's team in this league. */
  defaultTeamId: string;
  /** Asserted against league.json by check:league. */
  teams: number;
  /** Fantrax season code for the year-to-date stat reads (`SEASON_<code>_YEAR_TO_DATE`). */
  seasonCode: string;
  /** NHL season of the schedule this league plays on. */
  nhlSeasonId: number;
  /** Lineup locks, claim resets and "today" all follow this zone. */
  timeZone: string;
  slots: FantraxSlotTable;
  eligibility: FantraxEligibility;
  scoringSource: ScoringSource;
  /** Scoring-table column a plain forward scores by (see `ScoringBaseSlot`). */
  baseSlot: ScoringBaseSlot;
  dInSkt: DInSktFallback;
  cadence: FantraxCadence;
  limits: RosterLimits;
  /** Values for players this repo has no projection for, in THIS league's points. */
  priors: FantraxPriors;
  /**
   * Share of a league's ACTIVE players `check:league` insists we project. It
   * is a property of the ROSTER SHAPE the league mandates, not of the draft
   * clock: a league with Minors slots parks its unprojected prospects there
   * and its active lineups are all NHL regulars, while a league without them
   * has to leave juniors and late picks sitting ACTIVE. Broken name matching
   * is caught by `minProjectionsMatched` instead, which no roster shape can
   * move; this one only guards against a snapshot whose rosters stopped
   * resolving at all.
   */
  minActiveMatch: number;
  features: FantraxFeatures;
  /**
   * Which profile of the dynasty engine values this league (null = none):
   * "captains" = src/lib/dynasty/* as built for the Captains Dynasty League
   * (cutdown, minors eligibility, captain premium); "slapshot" = the same
   * engine under src/lib/dynasty/slapshot.ts (its scoring and replacement, no
   * cutdown, the salary-cap layer).
   */
  dynastyProfile: "captains" | "slapshot" | null;
  /** Commissioner salary cap, or null for a league without one. */
  salaryCap: SalaryCapConfig | null;
  paths: FantraxPathConfig;
}

/**
 * A league salary cap on real NHL cap hits. Only the rules live here; the
 * numbers per season (the cap, its growth, every player's cap hit) come from
 * the dynasty build (`<public>/contracts.json`), whose profile
 * (src/data/dynasty/<slug>/league.json `cap`) holds the one growth knob.
 */
export interface SalaryCapConfig {
  /** League cap in the first season, M$ (asserted against the dynasty profile by the tests). */
  base: number;
  /** Start year of the first capped season. */
  firstSeason: number;
  /** Roster statuses whose players count against the cap (IR and Minors do not). */
  countedStatuses: readonly string[];
  /** Spots that count (Active + Reserve): the cap is spread over them. */
  countedSpots: number;
}

/** Fantrax spells its slots the same way it spells `eligiblePos` tokens. */
const IDENTITY_TOKENS: Partial<Record<SlotId, readonly string[]>> = {};

/**
 * Captains Dynasty League — the league the tool was built for. Every value
 * here is the one that shipped before the config became per-league.
 */
export const CAPTAINS_DYNASTY: FantraxLeagueConfig = {
  slug: "captains-dynasty",
  leagueId: "aurcivgfmo2zpwm7",
  /** Quebec Trashers — confirmed by the user as their team. */
  defaultTeamId: "kgy7gzd8mo2zpwmj",
  teams: 16,
  /** Fantrax season code for 2026-27 (`SEASON_31n_YEAR_TO_DATE`). */
  seasonCode: "31n",
  nhlSeasonId: 20262027,
  timeZone: "America/Toronto",
  slots: {
    order: ["C", "W", "F", "D", "Skt", "G"],
    /** C3 W5 F1 D3 Skt1 G2 = 15. */
    counts: { C: 3, W: 5, F: 1, D: 3, Skt: 1, G: 2 },
  },
  eligibility: {
    // eligiblePos here reads "W,F,Skt" / "D,Skt" / "C,F,Skt" / "G": every
    // slot is named by its own token, the captain slot included.
    slotTokens: IDENTITY_TOKENS,
    skaterTokens: ["C", "W", "D"],
    defenseTokens: ["D"],
    goalieToken: "G",
    // One winger group: the lineup has a single W slot (plus the flex F), so
    // « which wing? » is a question this league never asks.
    groups: ["C", "W", "D", "G"],
    // "F" (the flex slot's token) needs no group of its own: every Captains
    // eligiblePos carrying it also carries C or W (verified over all 8,747
    // players of the league's universe).
    groupTokens: { C: ["C"], W: ["W"], D: ["D"], G: ["G"] },
  },
  scoringSource: "settings",
  // No slot of this league has its own row for an offensive category, so the
  // Default column IS the C / W / F column.
  baseSlot: "Default",
  dInSkt: "default",
  cadence: {
    scoringPeriods: 24,
    rosterPeriods: 188,
    scoringPeriodDays: 7,
    /** Monday (Eastern). */
    claimWeekStartsOn: 1,
  },
  limits: {
    minTotal: 15,
    maxActive: 15,
    maxReserve: 5,
    maxIr: 6,
    maxMinors: 35,
    healthyIrGracePeriods: 2,
  },
  priors: {
    /** p25 FP/G of the REALIZED 2025-26 regulars with >= 40 GP, Captains scoring. */
    fpg: { F: 2.52, D: 2.5 },
    /** The 48th goalie on the Captains points ladder (16 teams x 2 G, + depth). */
    goalieE: 3.65,
    pPlay: 0.6,
    /** Historical Captains value (its p25 rounded down). */
    regularMinFpg: 2.5,
  },
  /**
   * Its 35 Minors slots hold every unprojected prospect, so an ACTIVE lineup
   * here is all NHL regulars: 95% is what a healthy snapshot has always shown.
   */
  minActiveMatch: 0.95,
  features: {
    captainSlot: true,
    minors: true,
    gamesCaps: true,
    dynasty: true,
    keeperCutdown: true,
    minorsAnyPlayer: false,
    fxpa: true,
    claimsPerWeek: 5,
  },
  dynastyProfile: "captains",
  salaryCap: null,
  paths: {
    data: "src/data/fantrax",
    public: "public/fantrax",
    href: "",
  },
};

/**
 * Slapshot Fantasy League — 32 teams named after the NHL clubs, first season
 * (`getLeagueInfo` has no `leagueHistoryId`), HEAD_TO_HEAD_POINTS_BASED.
 * Settings read from the public fxea `getLeagueInfo` / `getTeamRosters` of
 * 2026-09-27; the rules fxea does not publish (dynasty, minors, IR, salary
 * cap, lineup lock) are the commissioner's, as the user relayed them.
 *
 * What makes it a different league, not a second copy of Captains:
 * - LW and RW are SEPARATE slots (Captains has one W plus a flex F), there
 *   is no captain slot; 20 starters (C4 LW4 RW4 D6 G2) instead of 15.
 * - Its scoring table carries per-slot zeros that MEAN zero (Hit and SB
 *   score 0 in every slot), so it is read from `scoringCategories` and
 *   scored in the `C` column (see `baseSlot`).
 * - 84 custom scoring periods of 1 to 4 days (playoffs: periods 83-84), daily
 *   lineups that lock 5 minutes before each game, no games-played caps.
 * - FULL DYNASTY, but not the Captains kind: every player carries over every
 *   season (the startup protected 1 keeper + 1 prospect a team, then a
 *   38-round snake draft), there is no September cutdown and ANY player may
 *   sit in the 17 Minors slots — so `keeperCutdown` is false and the dynasty
 *   engine runs under its own profile (`dynastyProfile: "slapshot"`).
 * - A salary cap on real NHL cap hits: 105 M$ in 2026-27, growing every year,
 *   counted over the 23 Active + Reserve players only (IR and Minors are
 *   free). A player's salary is his real cap hit for the season; after his
 *   contract ends, his next real NHL contract (projected until it is signed).
 * - fxpa answers `WARNING_NOT_LOGGED_IN` for this league while the same
 *   calls succeed on Captains, so there are no injury icons, no Ros%, no ages
 *   from Fantrax and no claim history: `features.fxpa` is false and the tool
 *   says it does not know rather than guessing.
 */
export const SLAPSHOT: FantraxLeagueConfig = {
  slug: "slapshot",
  leagueId: "glxjunc7mtxdqi8x",
  /** Vegas Golden Knights — confirmed by the user as their team. */
  defaultTeamId: "lz1ka65mmuh16mtf",
  teams: 32,
  /** Unused here (fxpa is closed), kept equal to the 2026-27 code. */
  seasonCode: "31n",
  nhlSeasonId: 20262027,
  timeZone: "America/Toronto",
  slots: {
    order: ["C", "LW", "RW", "D", "G"],
    /** C4 LW4 RW4 D6 G2 = 20 = rosterInfo.maxTotalActivePlayers. */
    counts: { C: 4, LW: 4, RW: 4, D: 6, G: 2 },
  },
  eligibility: {
    // eligiblePos reads "C", "LW", "RW", "LW,RW", "C,LW", "D", "G": every
    // slot is spelled by its own token, wingers by side.
    slotTokens: IDENTITY_TOKENS,
    skaterTokens: ["C", "LW", "RW", "D"],
    defenseTokens: ["D"],
    goalieToken: "G",
    // The wings are separate SEATS here (LW4 RW4), so they are separate
    // groups: the empty-slot alert says « 4 postes RW vides » and the filter
    // has to be able to list right wingers.
    groups: ["C", "LW", "RW", "D", "G"],
    groupTokens: { C: ["C"], LW: ["LW"], RW: ["RW"], D: ["D"], G: ["G"] },
  },
  // Its Hit / SB zeros only exist in this structure.
  scoringSource: "categories",
  // C, LW, RW, D and G each publish their own row: Default is unreachable.
  baseSlot: "C",
  // No captain slot at all, so the fallback never applies.
  dInSkt: "default",
  cadence: {
    /** 82 regular-season + 2 playoff matchups (periods 83-84). */
    scoringPeriods: 84,
    rosterPeriods: 152,
    /** Nominal: the 84 custom periods run 1 to 4 days (about four a week). */
    scoringPeriodDays: 2,
    scoringPeriodDaysRange: [1, 4],
    /** Each player locks 5 minutes before his own game (commissioner rule). */
    lock: { kind: "game", minutesBefore: 5 },
    /** Fantasy regular season = periods 1-82, through 2027-02-25 (the playoffs, 83-84, left out). */
    seasonShare: 0.746,
    /** The 38-round draft runs for days, 6 minutes a pick: re-read the picks every 20 s. */
    draftPollMs: 20_000,
    // No weekly claim reset could be confirmed (fxpa is closed), and a
    // 4-matchups-a-week cadence lines up with no weekday in particular.
    claimWeekStartsOn: null,
  },
  limits: {
    /** No published Active+Reserve minimum: never claim a roster is short. */
    minTotal: 0,
    maxActive: 20,
    maxReserve: 3,
    /** Commissioner rules: IR 5, Minors 17 (any player), neither counts toward the roster limits. */
    maxIr: 5,
    maxMinors: 17,
    /**
     * Not published, and unreachable anyway: without fxpa icons nobody on IR
     * can be called healthy (`iconsKnown: false`), so no grace period is
     * ever counted against the roster.
     */
    healthyIrGracePeriods: 2,
    /** fxea `maxTotalPlayers`: 40 = 20 Active + 3 Reserve + 17 Minors (IR apart). */
    maxTotal: 40,
  },
  priors: {
    /**
     * Measured on Slapshot's own scoring by `npm run league:report -- --league
     * slapshot --priors` (2026-09-26 projections): p25 FP/G of the PROJECTED
     * regulars with >= 40 GP — 455 forwards, 211 defencemen. About half
     * Captains' numbers, which is the scale difference between the two scoring
     * tables, and proof enough that they cannot be shared.
     */
    fpg: { F: 1.28, D: 0.89 },
    /**
     * E per start of the goalie on the last seat once every team keeps a
     * spare (32 x (2 + 1) = 96th on the points ladder): Ales Stezka, 4.70.
     * The same rule as Captains' 48th (16 x (2 + 1)).
     */
    goalieE: 4.7,
    pPlay: 0.6,
    /** The p25 above: the same quantity, so the same number. */
    regularMinFpg: 1.28,
  },
  /**
   * During the startup draft Fantrax seats every pick ACTIVE (221 ACTIVE, 5
   * MINORS on 2026-09-27), so junior keepers and late prospect picks sit
   * active with no projection to match until their owners move them to the
   * 17 Minors slots. A real name-match break is caught by
   * `minProjectionsMatched`, which this shape cannot move; the 95% shortfall
   * is still reported as a warning.
   */
  minActiveMatch: 0.5,
  features: {
    captainSlot: false,
    // 17 Minors slots, open to ANY player (no eligibility rule, so Fantrax's
    // minors-eligible flag means nothing here — and fxpa does not send it).
    minors: true,
    gamesCaps: false,
    dynasty: true,
    // Every player carries over: no September cutdown, no protected list.
    keeperCutdown: false,
    minorsAnyPlayer: true,
    fxpa: false,
    claimsPerWeek: null,
  },
  dynastyProfile: "slapshot",
  salaryCap: {
    base: 105,
    firstSeason: 2026,
    countedStatuses: ["ACTIVE", "RESERVE"],
    countedSpots: 23,
  },
  paths: {
    data: "src/data/fantrax/slapshot",
    public: "public/fantrax/slapshot",
    href: "slapshot",
  },
};

/** Every Fantrax league the engine knows, keyed by registry slug. */
export const FANTRAX_LEAGUES: Record<string, FantraxLeagueConfig> = {
  [CAPTAINS_DYNASTY.slug]: CAPTAINS_DYNASTY,
  [SLAPSHOT.slug]: SLAPSHOT,
};

/** The league every script works on unless `--league` says otherwise. */
export const DEFAULT_FANTRAX_SLUG = CAPTAINS_DYNASTY.slug;

export const FANTRAX_SLUGS: readonly string[] = Object.keys(FANTRAX_LEAGUES);

/** Config of one league; throws on an unknown slug (never silently league 1). */
export function fantraxLeague(slug: string = DEFAULT_FANTRAX_SLUG): FantraxLeagueConfig {
  const cfg = FANTRAX_LEAGUES[slug];
  if (!cfg) {
    throw new Error(`unknown Fantrax league "${slug}" (known: ${FANTRAX_SLUGS.join(", ")})`);
  }
  return cfg;
}

/**
 * A published file's name as the browser asks for it, under `/fantrax/`:
 * "values.json" for Captains, "<slug>/values.json" for the others. Pass the
 * result to `fantraxDataHref` (`src/lib/site.ts`).
 */
export function fantraxPublicFile(cfg: FantraxLeagueConfig, file: string): string {
  return cfg.paths.href ? `${cfg.paths.href}/${file}` : file;
}

/** The schedule file of a league's NHL season. */
export function fantraxScheduleFile(cfg: FantraxLeagueConfig): string {
  return `schedule-${cfg.nhlSeasonId}.json`;
}

/** `eligiblePos` tokens that fill `slot` in this league. */
export function slotTokens(cfg: FantraxLeagueConfig, slot: SlotId): readonly string[] {
  return cfg.eligibility.slotTokens[slot] ?? [slot];
}

/**
 * Slots of this league a player can fill, from Fantrax `eligiblePos`.
 * Fantrax names most slots exactly as it names the tokens, so the default is
 * the identity match; `eligibility.slotTokens` covers a league whose slot takes
 * other tokens (one W slot fed by LW and RW, say).
 *
 * It lives here, not beside the lineup optimizer: it is arithmetic on the
 * config, and anything importing it from `lineup.ts` dragged the Hungarian
 * solver into its bundle chunk.
 */
export function eligibleSlots(eligiblePos: string, cfg: FantraxLeagueConfig = CAPTAINS_DYNASTY): SlotId[] {
  const tokens = new Set(eligiblePos.split(",").map((t) => t.trim()));
  return cfg.slots.order.filter((s) => slotTokens(cfg, s).some((t) => tokens.has(t)));
}

/**
 * Groups a Fantrax `eligiblePos` puts a player in, in this league's own group
 * order. Empty only for a player whose tokens the config knows nothing about —
 * which is why `check:league` refuses such a league rather than letting him
 * vanish from the board.
 */
export function eligibleGroups(eligiblePos: string, cfg: FantraxLeagueConfig): FantraxGroup[] {
  const tokens = eligiblePos.split(",").map((t) => t.trim());
  const { groups, groupTokens } = cfg.eligibility;
  return groups.filter((g) => tokens.some((t) => (groupTokens[g] ?? []).includes(t)));
}

/**
 * The groups of `pos`, a pool record's concatenated group string ("CLW"), in
 * this league's group order. The league's own groups are the only vocabulary
 * tried, and no group of a league may be a substring of another
 * (`check:league` proves it), so the parse is unambiguous.
 */
export function parseGroups(pos: string, cfg: FantraxLeagueConfig): FantraxGroup[] {
  return cfg.eligibility.groups.filter((g) => pos.includes(g));
}

// ------------------------------------------------------------ legacy exports
// The Captains entry's fields under their historical names. Same values as
// before the config became per-league, so every importer is unaffected.

export const FANTRAX_LEAGUE_ID = CAPTAINS_DYNASTY.leagueId;
/** Quebec Trashers — confirmed by the user as their team. */
export const FANTRAX_DEFAULT_TEAM_ID = CAPTAINS_DYNASTY.defaultTeamId;
/** Fantrax season code for 2026-27 (`SEASON_31n_YEAR_TO_DATE`). */
export const FANTRAX_SEASON_CODE = CAPTAINS_DYNASTY.seasonCode;
export const NHL_SEASON_ID = CAPTAINS_DYNASTY.nhlSeasonId;

/** Lineup locks, claim resets and "today" all follow Eastern time. */
export const LEAGUE_TIME_ZONE = CAPTAINS_DYNASTY.timeZone;

/** Order the lineup table renders in (matches the Fantrax roster page). */
export const SLOT_ORDER: readonly SlotId[] = CAPTAINS_DYNASTY.slots.order;

/** Active slots per lineup (C3 W5 F1 D3 Skt1 G2 = 15). */
export const DEFAULT_SLOT_COUNTS: SlotCounts = CAPTAINS_DYNASTY.slots.counts;

export const DEFAULT_ROSTER_LIMITS: RosterLimits = CAPTAINS_DYNASTY.limits;

/** FA + WW claims per week; the counter resets Monday (Eastern). */
export const CLAIMS_PER_WEEK = CAPTAINS_DYNASTY.features.claimsPerWeek ?? 0;

export const D_IN_SKT_FALLBACK: DInSktFallback = CAPTAINS_DYNASTY.dInSkt;

// ------------------------------------------------------------ platform-wide

/**
 * Descriptive UA for build-time requests. Browsers ignore it (forbidden
 * header), which is fine: fxea is CORS-open and fxpa is never called there.
 */
export const SYNC_USER_AGENT =
  "fantasy-hockey-vor-league-sync/1.0 (+https://samuellachance.github.io/fantasy-hockey-vor; read-only, <=1 req/s)";

/**
 * Fantrax `scorer.icons[].typeId` values the tool acts on (tooltips seen in
 * the 2026-09-25 fxpa player lists). News icons (8/9/14) are ignored.
 */
export const FANTRAX_ICON = {
  /** "Day-to-Day" — may still dress; discounted, not ruled out. */
  dayToDay: "1",
  /** "Injured Reserve List" — on the NHL IR / LTIR. */
  nhlInjuredReserve: "2",
  /** Unsigned NHL free agent. */
  nhlFreeAgent: "3",
  /** "Minor Leagues" — assigned to the AHL/junior; earns nothing. */
  minorLeagues: "4",
  /** Suspended. */
  suspended: "6",
  /** "Inactive" — retired or out of the game. */
  inactive: "7",
  /** Injured ("Out Indefinitely"…). */
  injured: "30",
  /** Eligible for this league's Minors slots (<100 GP skater / <55 GP goalie, age <= 24). */
  minorsEligible: "31",
} as const;

/** Icons that zero a player's daily value outright. */
export const NON_PLAYING_ICONS: readonly string[] = [
  FANTRAX_ICON.injured,
  FANTRAX_ICON.nhlInjuredReserve,
  FANTRAX_ICON.suspended,
  FANTRAX_ICON.minorLeagues,
  FANTRAX_ICON.nhlFreeAgent,
  FANTRAX_ICON.inactive,
];

/**
 * Icons that make a Fantrax IR slot legitimate: any injury flag, and
 * suspensions ("Allow suspended players to be moved to Injured Reserve: Yes").
 */
export const IR_ELIGIBLE_ICONS: readonly string[] = [
  FANTRAX_ICON.dayToDay,
  FANTRAX_ICON.nhlInjuredReserve,
  FANTRAX_ICON.injured,
  FANTRAX_ICON.suspended,
];

/** Day-to-day players dress about half the time; their nightly value is discounted. */
export const DAY_TO_DAY_P_PLAY = 0.5;

/** Fantrax team label for players without an NHL club. */
export const FANTRAX_NO_TEAM = "(N/A)";

/**
 * Priors for players with no repo projection (2026 draftees, unmatched
 * prospects): p25 FP/G of 2025-26 regulars with >= 40 GP, and the 48th
 * goalie on the points ladder for E per start.
 */
export const PRIOR_FPG = { F: 2.52, D: 2.5 } as const;
export const PRIOR_GOALIE_E = 3.65;
/** Unprojected skaters rarely hold a nightly spot; discount their P(play). */
export const PRIOR_P_PLAY = 0.6;

/** Waiver targets below this gain over the rest of the scoring period are hidden. */
export const WAIVER_MIN_DELTA = 3;
/** Players this young with this Ros% are dynasty assets, never suggested as drops. */
export const DROP_PROTECT_MAX_AGE = 24;
export const DROP_PROTECT_MIN_ROS = 30;
/** The top-N players by season value are the keeper core: never dropped. */
export const DROP_PROTECT_TOP_N = 10;

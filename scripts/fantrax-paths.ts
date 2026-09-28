/**
 * Node side of the per-league Fantrax paths (`src/lib/fantrax/config.ts`
 * keeps only repo-relative POSIX strings so the client bundle can import
 * it). Shared by the sync, the CI guard, the CLI report and the dynasty
 * build, so one league's files can never be read under another's name.
 *
 * Captains Dynasty keeps the flat historical layout
 * (`src/data/fantrax/league.json`, `public/fantrax/values.json`); every
 * other league lives under `<slug>/`. See `FantraxPathConfig`.
 */
import { join } from "path";
import {
  DEFAULT_FANTRAX_SLUG,
  fantraxLeague,
  fantraxScheduleFile,
  type FantraxLeagueConfig,
} from "../src/lib/fantrax/config";

/** Repo-relative POSIX path of one of a league's committed inputs. */
export const fantraxDataRel = (cfg: FantraxLeagueConfig, file: string) => `${cfg.paths.data}/${file}`;
/** Repo-relative POSIX path of one of a league's published files. */
export const fantraxPublicRel = (cfg: FantraxLeagueConfig, file: string) => `${cfg.paths.public}/${file}`;

export interface FantraxLeaguePaths {
  /** Absolute path of a file in the league's committed input directory. */
  data: (file: string) => string;
  /** Absolute path of a file in the league's published directory. */
  public: (file: string) => string;
  league: string;
  nhlIds: string;
  today: string;
  overrides: string;
  prospectPool: string;
  values: string;
  state: string;
  pool: string;
  schedule: string;
  dynasty: string;
  /** Salary-cap league: the cap and every player's cap hits (derived from dynasty.json). */
  contracts: string;
  /** Shared repo inputs (one copy for every league). */
  players: string;
  profiles: string;
  draftRegistry: string;
  /** Who the NHL lists in each organisation (npm run nhl:rosters). */
  nhlRosters: string;
  /** Landing bios of the organisation players the profiles lack (npm run nhl:org-bios). */
  nhlOrgBios: string;
  leagueSeasons: string;
  dynastyParams: string;
  dynastyProspects: string;
  dynastyBenchmarks: string;
}

export function fantraxPaths(
  cfg: FantraxLeagueConfig,
  root: string = process.cwd(),
): FantraxLeaguePaths {
  const data = (file: string) => join(root, ...cfg.paths.data.split("/"), file);
  const pub = (file: string) => join(root, ...cfg.paths.public.split("/"), file);
  return {
    data,
    public: pub,
    league: data("league.json"),
    nhlIds: data("nhl-ids.json"),
    today: data("today.json"),
    overrides: data("id-overrides.json"),
    prospectPool: data("prospect-pool.json"),
    values: pub("values.json"),
    state: pub("state.json"),
    pool: pub("pool.json"),
    schedule: pub(fantraxScheduleFile(cfg)),
    dynasty: pub("dynasty.json"),
    contracts: pub("contracts.json"),
    players: join(root, "src", "data", "players.json"),
    profiles: join(root, "src", "data", "player-profiles.json"),
    draftRegistry: join(root, "src", "data", "draft-registry.json"),
    nhlRosters: join(root, "src", "data", "nhl-rosters.json"),
    nhlOrgBios: join(root, "src", "data", "nhl-org-bios.json"),
    leagueSeasons: join(root, "src", "data", "league-seasons.json"),
    dynastyParams: join(root, "src", "data", "dynasty", "params.json"),
    dynastyProspects: join(root, "src", "data", "dynasty", "prospects.json"),
    dynastyBenchmarks: join(root, "src", "data", "dynasty", "benchmarks.json"),
  };
}

/**
 * `--league <slug>` of the Fantrax scripts; the Captains league by default,
 * so every existing command line and every CI step keeps its behaviour.
 * An unknown slug throws (`fantraxLeague`) instead of silently syncing
 * league 1 under another league's name.
 */
export function fantraxLeagueFromArgs(args: readonly string[]): FantraxLeagueConfig {
  const i = args.indexOf("--league");
  if (i < 0) return fantraxLeague(DEFAULT_FANTRAX_SLUG);
  // `--league` with nothing after it is a typo: throw rather than write one
  // league's files from another league's flag.
  return fantraxLeague(args[i + 1] ?? "");
}

/** Same, for a script entry point: one `FAIL:` line instead of a stack trace. */
export function fantraxLeagueArg(args: readonly string[], script: string): FantraxLeagueConfig {
  try {
    return fantraxLeagueFromArgs(args);
  } catch (e) {
    console.error(`FAIL: ${script} — ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}

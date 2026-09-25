/**
 * Player identity helpers (pure): name normalization and NHL id resolution
 * for the Snake rows.
 */

/** Lowercase, accents folded, punctuation dropped, spaces collapsed. */
export function normalizePlayerName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[’'`.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export interface BoardPlayerRef {
  id: number;
  name: string;
  isGoalie?: boolean;
}

export type NhlIdSource = "direct" | "fantrax" | "name";

export interface ResolveContext {
  /** Fantrax id → NHL id (`src/data/fantrax/nhl-ids.json`). */
  fantraxToNhl: Readonly<Record<string, number>>;
  /** Normalized name → board players with that name (`src/data/players.json`). */
  boardByName: ReadonlyMap<string, readonly BoardPlayerRef[]>;
}

export function buildBoardNameIndex(players: readonly BoardPlayerRef[]): Map<string, BoardPlayerRef[]> {
  const out = new Map<string, BoardPlayerRef[]>();
  for (const p of players) {
    const k = normalizePlayerName(p.name);
    if (!k) continue;
    const list = out.get(k);
    if (list) list.push(p);
    else out.set(k, [p]);
  }
  return out;
}

function validNhlId(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : Number.NaN;
  return Number.isInteger(n) && n >= 8_000_000 && n < 9_000_000 ? n : null;
}

/**
 * NHL id for a Snake player: the source's own id, else the Fantrax → NHL
 * map, else a unique exact (normalized) name match on the board, where a
 * goalie never matches a skater.
 */
export function resolveNhlId(
  p: { nhlId?: string | number | null; fantraxId?: string | null; name: string; position?: string | null },
  ctx: ResolveContext,
): { id: number | null; via: NhlIdSource | null } {
  const direct = validNhlId(p.nhlId);
  if (direct) return { id: direct, via: "direct" };
  if (p.fantraxId) {
    const viaFx = validNhlId(ctx.fantraxToNhl[p.fantraxId]);
    if (viaFx) return { id: viaFx, via: "fantrax" };
  }
  const matches = ctx.boardByName.get(normalizePlayerName(p.name)) ?? [];
  const pos = p.position ?? null;
  const compatible = matches.filter((m) =>
    pos === "G" ? m.isGoalie === true : pos && pos !== "G" ? m.isGoalie !== true : true,
  );
  if (compatible.length === 1) return { id: compatible[0]!.id, via: "name" };
  return { id: null, via: null };
}

/** Position code shown on the site (source oddities become null). */
export function normalizePosition(pos: string | null | undefined): string | null {
  if (!pos) return null;
  const p = pos.trim().toUpperCase();
  return ["C", "LW", "RW", "D", "G", "F"].includes(p) ? p : null;
}

/** NHL team abbreviation or null ("(N/A)" and blanks). */
export function normalizeTeam(team: string | null | undefined): string | null {
  if (!team) return null;
  const t = team.trim().toUpperCase();
  return /^[A-Z]{2,3}$/.test(t) ? t : null;
}

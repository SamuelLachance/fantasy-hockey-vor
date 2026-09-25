/**
 * Source DB → public Snake files (pure; `scripts/build-snake-data.ts` does
 * the I/O). Applies the hand-checked corrections and the public-safety rules
 * of `./sanitize`, resolves NHL / Fantrax ids, and lays out the index, the
 * opinion shards, the rankings, the two compact lookups (board / Fantrax)
 * and the build-time summary.
 */
import { formatDraftFr } from "./copy";
import {
  SNAKE_OPINION_CORRECTIONS,
  SNAKE_RANKING_TITLE_CORRECTIONS,
  SNAKE_SYNTHESIS_CORRECTIONS,
  opinionCorrectionIndex,
  type SnakeOpinionCorrection,
  type SynthesisPatch,
} from "./corrections";
import { epochDay } from "./filters";
import {
  capText,
  isStance,
  isTrend,
  opinionRejection,
  opinionStartSeconds,
  publicList,
  publicText,
  timestampSeconds,
  unquote,
  verdictLine,
  type SourceOpinion,
  type SourcePlayer,
  type SourceVideo,
} from "./sanitize";
import {
  normalizePlayerName,
  normalizePosition,
  normalizeTeam,
  resolveNhlId,
  type NhlIdSource,
  type ResolveContext,
} from "./resolve";
import { SNAKE_SHARD_COUNT, snakeShardOf } from "./shard";
import { TRIM_MAX_DROPPED_SHARE, contentStems, traceList, traceSets, traceText, traceable } from "./trace";
import type {
  SnakeFantraxFile,
  SnakeIndexFile,
  SnakeListRow,
  SnakeNhlFile,
  SnakeOpinion,
  SnakeRanking,
  SnakeRankingsFile,
  SnakeRow,
  SnakeShardFile,
  SnakeStance,
  SnakeStats,
  SnakeSummaryFile,
  SnakeTrend,
  SnakeVideoRef,
} from "./types";

export interface SourceDb {
  builtAt: string;
  scout: string;
  stats?: { videos?: number; videosWithSnake?: number };
  players: SourcePlayer[];
  rankings: Array<{ videoId: string; date: string; show: string; title: string; entries: Array<{ rank: number; player: string }> }>;
  videos: Record<string, SourceVideo>;
}

export interface BuildContext extends ResolveContext {
  /** NHL ids on the VOR board (players.json). */
  boardIds: ReadonlySet<number>;
  /** NHL id → board position (G for goalies) and team. */
  boardPlayers?: ReadonlyMap<number, { pos: string | null; team: string | null }>;
  shardCount?: number;
  /** Defaults to `SNAKE_OPINION_CORRECTIONS` / `SNAKE_SYNTHESIS_CORRECTIONS`. */
  corrections?: readonly SnakeOpinionCorrection[];
  synthesisCorrections?: Readonly<Record<string, SynthesisPatch>>;
  rankingTitleCorrections?: Readonly<Record<string, string>>;
}

export interface SnakeBuildOutput {
  index: SnakeIndexFile;
  shards: SnakeShardFile[];
  rankings: SnakeRankingsFile;
  nhl: SnakeNhlFile;
  fantrax: SnakeFantraxFile;
  summary: SnakeSummaryFile;
  report: {
    idVia: Record<NhlIdSource | "none", number>;
    duplicateNhl: Array<{ nhl: number; keys: string[] }>;
    rankingEntriesLinked: number;
    rankingEntries: number;
    rankingsWithheld: number;
    rankingsTimed: number;
    /** Fantrax id / position replaced by the NHL id's own (source mismatch). */
    identityFixed: string[];
    /** Corrections that matched no source opinion (stale). */
    unusedCorrections: string[];
  };
}

/** Index summaries are clamped to three lines on the cards. */
export const INDEX_SUMMARY_MAX = 300;

const GUEST_SHOW = "Invité";
const CHANNEL_LABEL: Record<string, string> = {
  "Le Retour Avec Martin Lemay": "Le Retour avec Martin Lemay",
  Moi: "chaîne YouTube Moi",
};

/**
 * Show name as published: guest spots name the host program (its channel)
 * instead of one "Invité" bucket for seven different shows.
 */
export function showLabel(v: Pick<SourceVideo, "show" | "channel">): string {
  const show = v.show?.trim() || "Émission inconnue";
  if (show !== GUEST_SHOW) return show;
  const ch = v.channel?.trim();
  return ch ? `${CHANNEL_LABEL[ch] ?? ch} (Snake invité)` : "Snake invité";
}

/**
 * Clean one source opinion into its public form (caller already checked it
 * is publishable). Null when nothing is left once extraction notes are gone.
 */
export function toPublicOpinion(o: SourceOpinion): { op: SnakeOpinion; scrubbed: number } | null {
  const t = opinionStartSeconds(o);
  const extra = [
    ...new Set(o.timestamps.map(timestampSeconds).filter((s) => Number.isFinite(s) && s > 0 && s !== t)),
  ].sort((a, b) => a - b);
  const body = publicText(o.opinionFr);
  if (!body.text) return null;
  const cx = publicText(o.contextAtTime);
  const pj = publicText(o.projection);
  const op: SnakeOpinion = {
    vid: o.videoId,
    d: o.date,
    t,
    cx: cx.text,
    o: body.text,
    st: isStance(o.stance) ? o.stance : "neutre",
    pj: pj.removed ? null : pj.text,
    f: publicList(o.strengths, 6),
    w: publicList(o.weaknesses, 6),
    c: publicList(o.comparables, 6),
    rk: (o.rankMentions ?? [])
      .filter((r) => Number.isInteger(r.rank) && r.rank > 0 && typeof r.list === "string" && r.list.trim())
      .filter((r) => !publicText(r.list).removed)
      .map((r) => [r.rank, unquote(r.list)] as [number, string]),
  };
  if (extra.length) op.ts = extra;
  if (o.attribution === "probable") op.p = 1;
  return { op, scrubbed: body.removed + cx.removed + pj.removed };
}

function byDateDesc(a: SnakeOpinion, b: SnakeOpinion): number {
  return a.d < b.d ? 1 : a.d > b.d ? -1 : a.vid < b.vid ? -1 : a.vid > b.vid ? 1 : a.t - b.t;
}

/**
 * The published opinion a row without its synthesis stands on: the latest
 * one with a certain attribution, else the latest (every one is probable).
 */
export function standInOpinion(ops: readonly SnakeOpinion[]): SnakeOpinion {
  return ops.find((o) => !o.p) ?? ops[0]!;
}

/** Rankings whose own label flags deduced, reconstructed, relayed or unclear ranks. */
export const UNSURE_RANKING_RE =
  /déduit|déduction|reconstitu|incertain|inféré|\bprobabl|rapporté|formulée? par|non identifié|inaudible|transcri|sous-titre|implicite|confus|vraisemblablement|possiblement|cité par|par un auditeur|par l'animateur|attribution/i;
/** Labels saying the numbers are an order of mention, not a ranking. */
export const UNORDERED_RANKING_RE =
  /pas un classement|non class|sans ordre|non ordonn|ordre de (?:mention|présentation)|ordre d'énumération|pas de hiérarchie|pas une hiérarchie|pas un ordre|aucun ordre|ne pas faire d'ordre/i;

interface Draft {
  p: SourcePlayer;
  key: string;
  name: string;
  nhl: number | null;
  fx: string | null;
  pos: string | null;
  tm: string | null;
  dr: string | null;
  ops: SnakeOpinion[];
  /** Public synthesis (null = withheld: the row stands on one opinion). */
  synth: PublicSynthesis | null;
  aliasOf?: string;
}

/** Everything a synthesis contributes to the searchable text of an opinion. */
function opinionText(o: SourceOpinion): string {
  return [
    o.opinionFr,
    o.contextAtTime ?? "",
    o.projection ?? "",
    ...(o.strengths ?? []),
    ...(o.weaknesses ?? []),
    ...(o.comparables ?? []),
    ...(o.rankMentions ?? []).map((r) => r.list),
  ].join(" \n ");
}

export interface PublicSynthesis {
  v: SnakeStance;
  td: SnakeTrend;
  s: string;
  pj: string | null;
  f: string[];
  w: string[];
  c: string[];
  x: string | null;
  /** Parts were removed because only unpublished opinions supported them. */
  trimmed: boolean;
  scrubbed: number;
}

/**
 * The source synthesis as published, or null when it is withheld:
 *
 * - every source opinion published → published whole (scrubbed of notes);
 * - some dropped (under a third) → trimmed to what the published opinions
 *   support (`./trace`), its nuances / contradictions (written across all
 *   the opinions) dropped; withheld if half its sentences go;
 * - a third or more dropped → withheld.
 */
export function publicSynthesis(
  syn: SourcePlayer["synthesis"],
  playerName: string,
  sourceCount: number,
  publishedTexts: readonly string[],
  droppedTexts: readonly string[],
): PublicSynthesis | null {
  if (!isStance(syn.verdict) || publishedTexts.length === 0) return null;
  const st = publicText(syn.syntheseFr);
  const sx = publicText(syn.contradictions);
  const sp = publicText(syn.projection);
  if (!st.text) return null;
  const base = {
    v: syn.verdict,
    td: isTrend(syn.tendance) ? syn.tendance : ("inconnue" as SnakeTrend),
    scrubbed: st.removed + sx.removed + sp.removed,
  };
  const f0 = publicList(syn.forces, 6);
  const w0 = publicList(syn.faiblesses, 6);
  const c0 = publicList(syn.comparables, 6);
  const pj0 = sp.removed ? null : sp.text;
  if (droppedTexts.length === 0) {
    return { ...base, s: st.text, pj: pj0, f: f0, w: w0, c: c0, x: sx.text, trimmed: false };
  }
  if (droppedTexts.length / Math.max(sourceCount, 1) >= TRIM_MAX_DROPPED_SHARE) return null;
  const ignore = contentStems(playerName);
  const sets = traceSets(publishedTexts, droppedTexts, ignore);
  const s = traceText(st.text, sets, ignore);
  if (!s.text || s.kept / s.total < 0.5) return null;
  const f = traceList(f0, sets, ignore);
  const w = traceList(w0, sets, ignore);
  const c = traceList(c0, sets, ignore);
  const pj = pj0 && traceable(pj0, sets, ignore) ? pj0 : null;
  const trimmed =
    s.kept < s.total || f.length < f0.length || w.length < w0.length || c.length < c0.length || pj !== pj0 || !!sx.text;
  return { ...base, s: s.text, pj, f, w, c, x: null, trimmed };
}

/** Build every public Snake file from the source DB. */
export function buildSnakePublicData(db: SourceDb, ctx: BuildContext): SnakeBuildOutput {
  const shardCount = ctx.shardCount ?? SNAKE_SHARD_COUNT;
  const corrections = opinionCorrectionIndex(ctx.corrections ?? SNAKE_OPINION_CORRECTIONS);
  const synthesisCorrections = ctx.synthesisCorrections ?? SNAKE_SYNTHESIS_CORRECTIONS;
  const rankingTitles = ctx.rankingTitleCorrections ?? SNAKE_RANKING_TITLE_CORRECTIONS;
  const usedCorrections = new Set<string>();
  const rankingTitle = (vid: string, title: string) => {
    const k = `${vid}|${title}`;
    if (!(k in rankingTitles)) return title;
    usedCorrections.add(`ranking ${k}`);
    return rankingTitles[k]!;
  };
  const filtered: SnakeStats["filtered"] = {
    playersWithoutPublishableOpinion: 0,
    opinionsUncertainAttribution: 0,
    opinionsLowNameConfidence: 0,
    opinionsInvalid: 0,
    synthesesWithheld: 0,
    synthesesTrimmed: 0,
    sentencesScrubbed: 0,
    rankingsWithheld: 0,
  };
  const idVia: Record<NhlIdSource | "none", number> = { direct: 0, fantrax: 0, name: 0, none: 0 };
  const identityFixed: string[] = [];
  const fxOfNhl = new Map<number, string>();
  for (const [fx, id] of Object.entries(ctx.fantraxToNhl)) {
    if (Number.isInteger(id)) fxOfNhl.set(id, fx);
  }
  const video = (id: string) => db.videos[id]!;

  // ---- 1. opinions → drafts (corrections, safety rules, synthesis, identity)
  const drafts: Draft[] = [];
  for (const p of db.players) {
    const ops: SnakeOpinion[] = [];
    // Source texts the synthesis was written from, split by what is published.
    const publishedTexts: string[] = [];
    const droppedTexts: string[] = [];
    for (const raw of p.opinions) {
      const corr = corrections.get(`${p.key}|${raw.videoId}`);
      if (corr) usedCorrections.add(`${p.key}|${raw.videoId}`);
      if (corr?.drop) {
        filtered.opinionsLowNameConfidence++;
        droppedTexts.push(opinionText(raw));
        continue;
      }
      const o = corr?.set ? { ...raw, ...corr.set } : raw;
      // A content fix: the synthesis was written from the old paraphrase.
      if (corr?.set && !corr.wording) droppedTexts.push(opinionText(raw));
      const why = opinionRejection(o, db.videos[o.videoId] ?? null);
      if (why === "uncertain-attribution") filtered.opinionsUncertainAttribution++;
      else if (why === "low-name-confidence") filtered.opinionsLowNameConfidence++;
      else if (why === "invalid") filtered.opinionsInvalid++;
      if (why) {
        droppedTexts.push(opinionText(raw));
        continue;
      }
      const pub = toPublicOpinion(o);
      if (!pub) {
        filtered.opinionsInvalid++;
        droppedTexts.push(opinionText(raw));
        continue;
      }
      filtered.sentencesScrubbed += pub.scrubbed;
      ops.push(pub.op);
      publishedTexts.push(opinionText(o));
    }
    if (ops.length === 0) {
      filtered.playersWithoutPublishableOpinion++;
      continue;
    }
    ops.sort(byDateDesc);

    const syn = p.synthesis && isStance(p.synthesis.verdict) ? { ...p.synthesis, ...synthesisCorrections[p.key] } : null;
    const synth = syn ? publicSynthesis(syn, p.name, p.opinions.length, publishedTexts, droppedTexts) : null;
    if (synth) filtered.sentencesScrubbed += synth.scrubbed;
    if (synth?.trimmed) filtered.synthesesTrimmed++;
    if (!synth && p.synthesis) filtered.synthesesWithheld++;
    if (synth && synthesisCorrections[p.key]) usedCorrections.add(`synthesis ${p.key}`);

    const resolved = resolveNhlId(p, ctx);
    idVia[resolved.via ?? "none"]++;
    let fx = p.fantraxId || null;
    let tm = normalizeTeam(p.team);
    let pos = normalizePosition(p.position);
    if (resolved.id) {
      // The NHL id wins: a source Fantrax id that is not this player's (a
      // namesake free agent) would put the wrong position and /league chip
      // on him.
      const own = fxOfNhl.get(resolved.id);
      const board = ctx.boardPlayers?.get(resolved.id);
      if (own && own !== fx) {
        if (fx) identityFixed.push(`${p.key}: Fantrax ${fx} → ${own}`);
        fx = own;
        if (board?.team) tm = board.team;
      }
      if (board?.pos) pos = board.pos;
      if (!tm && board?.team) tm = board.team;
    }
    drafts.push({
      p,
      key: p.key,
      name: p.name.trim(),
      nhl: resolved.id,
      fx,
      pos,
      tm,
      dr: p.draft?.trim() ? formatDraftFr(p.draft.trim()) : null,
      ops,
      synth,
    });
  }

  // ---- 2. one player, two source records (e.g. "Zack" under his Fantrax id
  // and "Zachary" under his NHL id): fold the smaller record's opinions into
  // the larger one and keep its key as an alias for old links. The kept
  // record's synthesis only ever used its own source opinions.
  const aliases: Record<string, string> = {};
  const aliasNames: Array<[string, string]> = [];
  const duplicateNhl: Array<{ nhl: number; keys: string[] }> = [];
  {
    const byNhl = new Map<number, Draft[]>();
    for (const d of drafts) {
      if (!d.nhl) continue;
      const list = byNhl.get(d.nhl) ?? [];
      list.push(d);
      byNhl.set(d.nhl, list);
    }
    for (const [nhl, group] of byNhl) {
      if (group.length < 2) continue;
      group.sort((a, b) => b.ops.length - a.ops.length || (a.key < b.key ? -1 : 1));
      const [main, ...rest] = group as [Draft, ...Draft[]];
      duplicateNhl.push({ nhl, keys: group.map((g) => g.key) });
      const seen = new Set(main.ops.map((o) => `${o.vid}|${o.t}`));
      for (const r of rest) {
        for (const o of r.ops) {
          if (seen.has(`${o.vid}|${o.t}`)) continue;
          seen.add(`${o.vid}|${o.t}`);
          main.ops.push(o);
        }
        aliases[r.key] = main.key;
        aliasNames.push([r.name, main.key]);
        r.aliasOf = main.key;
        if (!main.fx && r.fx) main.fx = r.fx;
        if (!main.pos && r.pos) main.pos = r.pos;
        if (!main.tm && r.tm) main.tm = r.tm;
        if (!main.dr && r.dr) main.dr = r.dr;
      }
      main.ops.sort(byDateDesc);
    }
  }
  const kept = drafts.filter((d) => !d.aliasOf);

  // ---- 3. rows
  const players: Array<{ row: SnakeRow; ops: SnakeOpinion[] }> = kept.map((d) => {
    const ops = d.ops;
    const dates = ops.map((o) => o.d).sort();
    const probable = ops.filter((o) => o.p).length;
    let v: SnakeStance;
    let td: SnakeTrend = "inconnue";
    let s: string;
    let pj: string | null;
    let f: string[];
    let w: string[];
    let c: string[];
    let x: string | null = null;
    let sd: string | null = null;
    if (d.synth) {
      ({ v, td, s, pj, f, w, c, x } = d.synth);
    } else {
      // Stand-in: one published opinion (a certain one when there is one),
      // and strengths / weaknesses from opinions of the same attribution
      // level, so nothing "probable" reads as certain.
      const stand = standInOpinion(ops);
      const basis = stand.p ? ops : ops.filter((o) => !o.p);
      s = stand.o;
      v = stand.st;
      pj = stand.pj;
      sd = stand.d;
      f = publicList(basis.flatMap((o) => o.f), 5);
      w = publicList(basis.flatMap((o) => o.w), 5);
      c = publicList(basis.flatMap((o) => o.c), 5);
    }
    const row: SnakeRow = {
      k: d.key,
      n: d.name,
      pos: d.pos,
      tm: d.tm,
      nhl: d.nhl,
      fx: d.fx,
      dr: d.dr,
      v,
      td,
      pj,
      s,
      f,
      w,
      c,
      x,
      l: ops[0]!.st,
      oc: ops.length,
      vc: new Set(ops.map((o) => o.vid)).size,
      pc: probable,
      fs: dates[0]!,
      ls: dates[dates.length - 1]!,
    };
    if (probable === ops.length) row.pr = 1;
    if (d.nhl && ctx.boardIds.has(d.nhl)) row.b = 1;
    if (!d.synth) {
      row.dv = 1;
      row.sd = sd!;
    } else if (d.synth.trimmed) {
      row.tr = 1;
    }
    return { row, ops };
  });

  // Shows in a stable order: most published opinions first.
  const showCounts = new Map<string, { videos: Set<string>; opinions: number }>();
  for (const { ops } of players) {
    for (const o of ops) {
      const show = showLabel(video(o.vid));
      let sc = showCounts.get(show);
      if (!sc) showCounts.set(show, (sc = { videos: new Set(), opinions: 0 }));
      sc.videos.add(o.vid);
      sc.opinions++;
    }
  }
  const shows = [...showCounts.entries()]
    .sort((a, b) => b[1].opinions - a[1].opinions || (a[0] < b[0] ? -1 : 1))
    .map(([name]) => name);
  const showIndex = new Map(shows.map((s, i) => [s, i]));

  // Stable player order: most opinions first, then key.
  players.sort((a, b) => b.row.oc - a.row.oc || (a.row.k < b.row.k ? -1 : 1));

  // ---- shards (+ the aliases hashed to each, so an old key resolves
  // without waiting for the index)
  const shards: SnakeShardFile[] = Array.from({ length: shardCount }, () => ({ v: 1, videos: {}, players: {} }));
  for (const { row, ops } of players) {
    const shard = shards[snakeShardOf(row.k, shardCount)]!;
    shard.players[row.k] = { r: row, o: ops };
    for (const o of ops) {
      const vid = video(o.vid);
      shard.videos[o.vid] = [vid.date, showLabel(vid), vid.title] satisfies SnakeVideoRef;
    }
  }
  for (const [from, to] of Object.entries(aliases).sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const shard = shards[snakeShardOf(from, shardCount)]!;
    (shard.aliases ??= {})[from] = to;
  }

  // ---- index: slim rows (what the list reads) + the mention list for the
  // show / period filters. The full row lives in the player's shard.
  const rows: SnakeListRow[] = players.map(({ row, ops }) => {
    const m: number[] = [];
    for (const o of ops) m.push(showIndex.get(showLabel(video(o.vid)))!, epochDay(o.d));
    const slim: SnakeListRow = {
      k: row.k,
      n: row.n,
      pos: row.pos,
      tm: row.tm,
      fx: row.fx,
      v: row.v,
      td: row.td,
      s: capText(row.s, INDEX_SUMMARY_MAX),
      oc: row.oc,
      ls: row.ls,
    };
    if (row.pr) slim.pr = 1;
    if (row.dv) slim.dv = 1;
    slim.m = m;
    return slim;
  });

  // ---- rankings (names linked to published players when unambiguous;
  // timed at the published opinions of the same video that give those ranks)
  const byName = new Map<string, string | null>();
  for (const [name, key] of [...players.map((p) => [p.row.n, p.row.k] as [string, string]), ...aliasNames]) {
    const k = normalizePlayerName(name);
    byName.set(k, byName.has(k) && byName.get(k) !== key ? null : key);
  }
  const opsByVideo = new Map<string, Array<{ key: string; o: SnakeOpinion }>>();
  for (const { row, ops } of players) {
    for (const o of ops) {
      const list = opsByVideo.get(o.vid) ?? [];
      list.push({ key: row.k, o });
      opsByVideo.set(o.vid, list);
    }
  }
  let rankingEntries = 0;
  let rankingEntriesLinked = 0;
  let rankingsTimed = 0;
  const rankings: SnakeRanking[] = [];
  for (const r of db.rankings) {
    const vid = db.videos[r.videoId];
    if (!vid || vid.snakePresent !== true || !Array.isArray(r.entries) || r.entries.length === 0) continue;
    // A list whose label says ranks were deduced, reconstructed, relayed by
    // someone else or unclear is never published (nor is its label).
    if (UNSURE_RANKING_RE.test(r.title) || publicText(r.title).removed) {
      filtered.rankingsWithheld++;
      continue;
    }
    const entries = r.entries
      .filter((x) => Number.isInteger(x.rank) && x.rank > 0 && typeof x.player === "string" && x.player.trim())
      .sort((a, b) => a.rank - b.rank);
    if (entries.length === 0) continue;
    let linked = 0;
    const e: SnakeRanking["e"] = entries.map((x) => {
      const key = byName.get(normalizePlayerName(x.player)) ?? null;
      if (key) linked++;
      return [x.rank, x.player.trim(), key];
    });
    rankingEntries += e.length;
    rankingEntriesLinked += linked;
    // Passage: published opinions from this video on the listed players,
    // preferring the ones that state the same rank.
    const rankOf = new Map(e.filter((x) => x[2]).map((x) => [x[2]!, x[0]]));
    const here = (opsByVideo.get(r.videoId) ?? []).filter((x) => rankOf.has(x.key));
    const strong = here.filter((x) => x.o.rk.some(([rank]) => rank === rankOf.get(x.key)));
    const pool = strong.length ? strong : here;
    const t = pool.length ? Math.min(...pool.map((x) => x.o.t)) : 0;
    if (t > 0) rankingsTimed++;
    const ranking: SnakeRanking = {
      vid: r.videoId,
      d: r.date,
      sh: showLabel(vid),
      ti: unquote(rankingTitle(r.videoId, r.title)),
      vt: vid.title,
      t,
      e,
    };
    if (UNORDERED_RANKING_RE.test(r.title)) ranking.u = 1;
    rankings.push(ranking);
  }
  rankings.sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : a.vid < b.vid ? -1 : a.vid > b.vid ? 1 : a.ti < b.ti ? -1 : 1));

  // ---- lookups (NHL ids are unique after the merge above)
  const nhlRows: SnakeNhlFile["rows"] = {};
  const fxRows: SnakeFantraxFile["rows"] = {};
  const summaryRows: SnakeSummaryFile["rows"] = {};
  const summaryNhl: Record<string, string> = {};
  const summaryFx: Record<string, string> = {};
  for (const { row } of players) {
    const line = verdictLine(row.s, row.v, row.pj);
    const probable: 0 | 1 = row.pr ? 1 : 0;
    summaryRows[row.k] = [row.v, row.td, line, probable];
    if (row.nhl && !nhlRows[String(row.nhl)]) {
      nhlRows[String(row.nhl)] = [row.k, row.v, row.td, probable];
      summaryNhl[String(row.nhl)] = row.k;
    }
    if (row.fx && !fxRows[row.fx]) {
      fxRows[row.fx] = [row.k, row.v, row.td, line, probable];
      summaryFx[row.fx] = row.k;
    }
  }

  const allDates = players.flatMap((p) => [p.row.fs, p.row.ls]).sort();
  const stats: SnakeStats = {
    videos: db.stats?.videos ?? Object.keys(db.videos).length,
    videosWithSnake: db.stats?.videosWithSnake ?? Object.values(db.videos).filter((v) => v.snakePresent).length,
    players: players.length,
    opinions: players.reduce((n, p) => n + p.row.oc, 0),
    probableOpinions: players.reduce((n, p) => n + p.row.pc, 0),
    citedVideos: new Set(players.flatMap((p) => p.ops.map((o) => o.vid))).size,
    rankings: rankings.length,
    filtered,
    firstDate: allDates[0] ?? "",
    lastDate: allDates[allDates.length - 1] ?? "",
    byShow: shows.map((show) => ({
      show,
      videos: showCounts.get(show)!.videos.size,
      opinions: showCounts.get(show)!.opinions,
    })),
  };

  return {
    index: { v: 1, builtAt: db.builtAt, scout: db.scout, shows, shardCount, stats, aliases, rows },
    shards,
    rankings: { v: 1, builtAt: db.builtAt, rankings },
    nhl: { v: 1, rows: nhlRows },
    fantrax: { v: 1, rows: fxRows },
    summary: {
      v: 1,
      builtAt: db.builtAt,
      scout: db.scout,
      stats,
      rows: summaryRows,
      aliases,
      nhl: summaryNhl,
      fx: summaryFx,
    },
    report: {
      idVia,
      duplicateNhl,
      rankingEntries,
      rankingEntriesLinked,
      rankingsWithheld: filtered.rankingsWithheld,
      rankingsTimed,
      identityFixed,
      unusedCorrections: [
        ...[...corrections.keys()].filter((k) => !usedCorrections.has(k)),
        ...Object.keys(synthesisCorrections).filter((k) => !usedCorrections.has(`synthesis ${k}`)).map((k) => `synthesis ${k}`),
        ...Object.keys(rankingTitles).filter((k) => !usedCorrections.has(`ranking ${k}`)).map((k) => `ranking ${k}`),
      ],
    },
  };
}

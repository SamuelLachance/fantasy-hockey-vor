/**
 * Unit checks for the Snake layer: public-safety filters, synthesis
 * tracing, corrections, id resolution, shard lookup, the build on a small
 * fixture, the verbatim guard, the /snake list filters and the URL / copy
 * helpers.
 * Run: npx tsx scripts/test-snake-data.ts
 */
import { boardRowAriaLabel } from "../src/lib/board-row-a11y";
import { siteNavLinks } from "../src/lib/site-nav";
import { buildSnakePublicData, publicSynthesis, showLabel, standInOpinion, type SourceDb } from "../src/lib/snake/build";
import {
  SNAKE_DISCLAIMER_FULL,
  SNAKE_DISCLAIMER_SHORT,
  formatCountFr,
  formatDraftFr,
  formatSnakeDate,
  plural,
  seasonOf,
  snakeBoardRowSuffix,
  snakeDerivedNote,
  snakeVerdictAria,
  stanceScore,
} from "../src/lib/snake/copy";
import { SNAKE_OPINION_CORRECTIONS, SNAKE_SYNTHESIS_CORRECTIONS } from "../src/lib/snake/corrections";
import {
  DEFAULT_SNAKE_FILTERS,
  activeSnakeFilterCount,
  epochDay,
  filterSnakeRows,
  mentionCount,
  periodRange,
  sortSnakeItems,
} from "../src/lib/snake/filters";
import { snakeFantraxSeed } from "../src/lib/snake/league-seed";
import {
  buildBoardNameIndex,
  normalizePlayerName,
  normalizePosition,
  normalizeTeam,
  resolveNhlId,
} from "../src/lib/snake/resolve";
import {
  oneLine,
  opinionRejection,
  opinionStartSeconds,
  publicList,
  publicText,
  scrubNotes,
  scrubUncertain,
  splitSentences,
  timestampSeconds,
  unquote,
  verdictLine,
  type SourceOpinion,
  type SourcePlayer,
} from "../src/lib/snake/sanitize";
import { SNAKE_SHARD_COUNT, fnv1a32, snakeShardFile, snakeShardFileForKey, snakeShardOf } from "../src/lib/snake/shard";
import { contentStems, traceSets, traceable } from "../src/lib/snake/trace";
import type { SnakeListRow, SnakeOpinion } from "../src/lib/snake/types";
import {
  boardPlayerHref,
  formatClock,
  snakeDataHref,
  snakeKeyFromSearch,
  snakePlayerHref,
  snakeSearch,
  youtubeHref,
} from "../src/lib/snake/url";
import { longestSharedRun, ngramSet, transcriptWords, verbatimWords } from "../src/lib/snake/verbatim";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}
const eq = (a: unknown, b: unknown, msg: string) =>
  assert(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const NB = " ";

// ---- public-safety filters
const base = { videoId: "abcdefghijk", date: "2026-09-22", opinionFr: "Bon joueur.", stance: "positif" };
eq(opinionRejection({ ...base, attribution: "certain", nameConfidence: "haute" }), null, "certain is published");
eq(opinionRejection({ ...base, attribution: "probable", nameConfidence: "moyenne" }), null, "probable is published");
eq(opinionRejection({ ...base, attribution: "incertain", nameConfidence: "haute" }), "uncertain-attribution", "incertain never");
eq(opinionRejection({ ...base, attribution: "", nameConfidence: "haute" }), "uncertain-attribution", "unknown attribution never");
eq(opinionRejection({ ...base, attribution: "certain", nameConfidence: "basse" }), "low-name-confidence", "weak name match dropped");
eq(opinionRejection({ ...base, attribution: "certain", nameConfidence: "haute", stance: "génial" }), "invalid", "unknown stance");
eq(opinionRejection({ ...base, attribution: "certain", nameConfidence: "haute" }, { snakePresent: false }), "invalid", "Snake absent from the video");
eq(opinionRejection({ ...base, attribution: "certain", nameConfidence: "haute" }, null), "invalid", "unknown video");
eq(
  opinionRejection({
    ...base,
    attribution: "probable",
    nameConfidence: "haute",
    opinionFr: "En 2022, il le classait 1er. Une prédiction de 70 points est lancée (attribution de ce passage incertaine).",
  }),
  "uncertain-attribution",
  "an opinion flagging part of itself as uncertain is dropped whole (its projection came from that passage)",
);
for (const note of [
  "Le nom manque dans la transcription : il est déduit par élimination.",
  "Les sous-titres ne donnent pas le nom, mais le contexte désigne Tippett.",
  "Dans ce passage, le nom est inaudible mais semble être le sien.",
  "Il adore sa fougue. Le nom n'est pas prononcé : il est déduit du contexte.",
]) {
  eq(opinionRejection({ ...base, attribution: "certain", nameConfidence: "haute", opinionFr: note }), "low-name-confidence", `inferred name: ${note}`);
}
eq(
  opinionRejection({ ...base, attribution: "probable", nameConfidence: "moyenne", contextAtTime: "Fils de Kent Hughes. Ce n'est pas le Jack Hughes des Devils." }),
  "low-name-confidence",
  "a context note naming a namesake drops the opinion",
);
eq(
  opinionRejection({ ...base, attribution: "certain", nameConfidence: "haute", opinionFr: "Ce n'est pas le même type de joueur que Martone." }),
  null,
  "ordinary 'ce n'est pas le même…' prose stays",
);

eq(
  scrubUncertain("Il l'adore. Une opinion incertaine de 2026 le juge moyen. Il le voit dans le top 6."),
  { text: "Il l'adore. Il le voit dans le top 6.", removed: 1 },
  "sentence about an uncertain-attribution opinion removed",
);
eq(scrubUncertain("En 2025 (attribution incertaine), il le jugeait lent.").text, null, "only sentence removed → null");
eq(scrubUncertain("Deux opinions négatives (dont une incertaine) le disaient lent. Fin.").removed, 1, "dont une incertaine");
eq(scrubUncertain("Mars 2026 (incertain, attribué à un intervenant) en fait un #1.").removed, 1, "(incertain, …)");
eq(scrubUncertain("Il serait ce joueur, mais l'identification est incertaine.").removed, 1, "identification incertaine");
eq(scrubUncertain("Son avenir dans la LNH reste incertain. Top 6 incertain.").removed, 0, "plain uses of the word about the player's future stay");
eq(
  scrubNotes("Il place DuPont très haut (passage mal transcrit). Il le voit gagner des Coupes. Les sous-titres brouillent ce passage."),
  { text: "Il le voit gagner des Coupes.", removed: 2 },
  "caption / transcription notes removed with their sentence",
);
eq(scrubNotes("Deux opinions portent sur un autre joueur. Il faut les ignorer.").removed, 1, "extraction instruction removed");
eq(publicText("Bon « gadget ». Nom déformé par la transcription.").text, "Bon gadget.", "public text: notes gone, unquoted");
eq(publicList(["Vitesse", "vitesse", "Tir (attribution incertaine)", "« Gadget »", "« Ben Byron » (nom mal transcrit)"]), ["Vitesse", "Gadget"], "list cleaned");
eq(unquote("un joueur « gadget » d'avantage numérique"), "un joueur gadget d'avantage numérique", "guillemets removed");
eq(unquote('Il a dit "très bon joueur" hier'), "Il a dit très bon joueur hier", "straight quotes removed");
eq(unquote("L'équipe d'Hutson"), "L'équipe d'Hutson", "apostrophes kept");
eq(unquote(`Gros centre (6'3", 205 lb), plus grand que 6'1"`), "Gros centre (6′3″, 205 lb), plus grand que 6′1″", "heights become primes, not quotes");
eq(unquote('un "tireur'), "un tireur", "stray quote dropped");
eq(splitSentences("Il est bon. Très bon! Vraiment? Oui…"), ["Il est bon.", "Très bon!", "Vraiment?", "Oui…"], "sentences");
eq(oneLine("Première phrase. Deuxième."), "Première phrase.", "one line = first sentence");
assert(oneLine("a ".repeat(200), 140).length <= 140, "one line capped");
assert(oneLine("a ".repeat(200), 140).endsWith("…"), "capped line ends with an ellipsis");

// ---- verdict one-liners (/league) agree with the chip
eq(
  verdictLine("Snake a longtemps adoré Peterka. Depuis son échange, son avis s'est refroidi. Il le trouve mou.", "mitigé", null),
  "Depuis son échange, son avis s'est refroidi.",
  "a mixed verdict skips a glowing sentence about the past",
);
eq(
  verdictLine("Il le voyait comme un très bon ailier de top 6. Il approuvait pourtant son échange. Il le trouve mou et peu physique.", "mitigé", null),
  "Il le trouve mou et peu physique.",
  "imperfect-tense history skipped",
);
eq(
  verdictLine("Snake aime l'énergie et la robustesse de Sherwood. Son contrat le rend toutefois ambivalent.", "mitigé", null),
  "Son contrat le rend toutefois ambivalent.",
  "positive-only sentence skipped for a mixed verdict",
);
eq(verdictLine("Snake adore Hutson.", "très positif", null), "Snake adore Hutson.", "positive verdict, positive line");
eq(verdictLine("Pour Snake, il a été excellent pendant des années.", "mitigé", "Vétéran de soutien"), "Projection : Vétéran de soutien", "falls back to the projection");
eq(verdictLine("Snake l'adore.", "négatif", null), "", "no agreeing sentence and no projection → no line");

// ---- timestamps
eq(timestampSeconds("00:15:09"), 909, "hh:mm:ss");
eq(timestampSeconds("15:09"), 909, "mm:ss");
assert(Number.isNaN(timestampSeconds("15")), "malformed");
const op = { videoId: "C0ZYFRVjXQU", timestamps: ["00:17:12"], url: "https://www.youtube.com/watch?v=C0ZYFRVjXQU&t=909s" };
eq(opinionStartSeconds(op), 909, "start from the source link");
eq(opinionStartSeconds({ ...op, url: "https://www.youtube.com/watch?v=C0ZYFRVjXQU" }), 1032, "start from the first timestamp");
eq(opinionStartSeconds({ ...op, url: "https://www.youtube.com/watch?v=XXXXXXXXXXX&t=5s" }), 1032, "link to another video ignored");
eq(
  opinionStartSeconds({ videoId: "C0ZYFRVjXQU", timestamps: ["00:00:00", "00:37:27"], url: "https://www.youtube.com/watch?v=C0ZYFRVjXQU&t=0s" }),
  2247,
  "a 0:00 start (cold open) gives way to the passage's own timestamp",
);
eq(opinionStartSeconds({ videoId: "C0ZYFRVjXQU", timestamps: ["00:00:00"], url: "" }), 0, "0:00 only → video start");

// ---- synthesis tracing
{
  const ignore = contentStems("Mikko Rantanen");
  const sets = traceSets(
    ["Il regrette de l'avoir classé 6e en 2015. Il lui reproche un effort inégal et un côté nonchalant."],
    ["Malgré ses saisons de 100 points, Rantanen n'est pas une mégastar.", "Il le compare à Cory Urquhart."],
    ignore,
  );
  assert(!traceable("Pour lui, ce n'est pas une mégastar.", sets, ignore), "a claim only an unpublished opinion makes is cut");
  assert(!traceable("Cory Urquhart", sets, ignore), "a comparable only an unpublished opinion gives is cut");
  assert(!traceable("saisons de 100 points", sets, ignore), "a strength only an unpublished opinion lists is cut");
  assert(traceable("Il lui reproche un effort inégal.", sets, ignore), "a claim the published opinions make stays");
  assert(!traceable("Il le trouve rapide et spectaculaire.", sets, ignore), "an unsupported claim is cut");
}
{
  const syn = {
    syntheseFr: "Il regrette de l'avoir classé 6e en 2015. Pour lui, ce n'est pas une mégastar. Il lui reproche un effort inégal.",
    verdict: "mitigé",
    tendance: "stable",
    projection: "Ailier de 1er trio",
    forces: ["saisons de 100 points", "classé 6e en 2015"],
    faiblesses: ["effort inégal"],
    comparables: ["Cory Urquhart"],
    contradictions: "Il le disait nonchalant, puis non.",
  };
  const published = ["Il regrette de l'avoir classé 6e en 2015. Il lui reproche un effort inégal. Ailier de 1er trio."];
  const dropped = ["Malgré ses saisons de 100 points, Rantanen n'est pas une mégastar. Comparable : Cory Urquhart."];
  const full = publicSynthesis(syn, "Mikko Rantanen", 1, published, []);
  eq([full?.trimmed, full?.x !== null, full?.f.length], [false, true, 2], "nothing dropped → synthesis published whole");
  const trimmed = publicSynthesis(syn, "Mikko Rantanen", 4, published, dropped)!;
  eq(trimmed.s, "Il regrette de l'avoir classé 6e en 2015. Il lui reproche un effort inégal.", "sentence from the unpublished opinion cut");
  eq([trimmed.f, trimmed.c, trimmed.x, trimmed.pj, trimmed.trimmed], [["classé 6e en 2015"], [], null, "Ailier de 1er trio", true], "items from it cut, nuances dropped");
  assert(!JSON.stringify(trimmed).includes("mégastar") && !JSON.stringify(trimmed).includes("Urquhart"), "no unpublished material survives");
  eq(publicSynthesis(syn, "Mikko Rantanen", 3, published, dropped), null, "a third of the inputs dropped → withheld");
  eq(publicSynthesis({ ...syn, syntheseFr: "Pour lui, ce n'est pas une mégastar. Malgré ses saisons de 100 points. Il lui reproche un effort inégal." }, "Mikko Rantanen", 10, published, dropped), null, "most sentences cut → withheld");
}

// ---- corrections are well-formed
{
  const seen = new Set<string>();
  for (const c of SNAKE_OPINION_CORRECTIONS) {
    const k = `${c.key}|${c.vid}`;
    assert(!seen.has(k), `one correction per opinion: ${k}`);
    seen.add(k);
    assert(!!c.drop !== !!c.set, `correction ${k} either drops or sets`);
    assert(/^[\w-]{11}$/.test(c.vid), `correction ${k}: video id`);
    for (const t of [c.set?.opinionFr, ...(c.set?.weaknesses ?? [])]) if (t) eq(publicText(t).removed, 0, `correction ${k} carries no note`);
  }
  for (const [k, s] of Object.entries(SNAKE_SYNTHESIS_CORRECTIONS)) assert(!!s.syntheseFr?.trim(), `synthesis correction ${k}`);
}

// ---- id resolution
eq(normalizePlayerName("Juraj Slafkovský"), "juraj slafkovsky", "accents folded");
eq(normalizePlayerName("K'Andre  Miller"), "kandre miller", "apostrophes dropped");
eq(normalizePlayerName("P.K. Subban"), "pk subban", "dots dropped");
const board = [
  { id: 8483457, name: "Lane Hutson", isGoalie: false },
  { id: 8480000, name: "Sam Smith", isGoalie: false },
  { id: 8480001, name: "Sam Smith", isGoalie: false },
  { id: 8480002, name: "Joe Goalie", isGoalie: true },
];
const ctx = { fantraxToNhl: { "05wwg": 8483457, bad: 12 }, boardByName: buildBoardNameIndex(board) };
eq(resolveNhlId({ nhlId: "8483457", fantraxId: null, name: "x" }, ctx), { id: 8483457, via: "direct" }, "direct id");
eq(resolveNhlId({ nhlId: null, fantraxId: "05wwg", name: "x" }, ctx), { id: 8483457, via: "fantrax" }, "via Fantrax map");
eq(resolveNhlId({ nhlId: null, fantraxId: "bad", name: "Lane Hutson" }, ctx), { id: 8483457, via: "name" }, "invalid mapped id falls through to the name");
eq(resolveNhlId({ nhlId: null, fantraxId: null, name: "Lane Hutsón" }, ctx), { id: 8483457, via: "name" }, "unique name match");
eq(resolveNhlId({ nhlId: null, fantraxId: null, name: "Sam Smith" }, ctx), { id: null, via: null }, "ambiguous name → none");
eq(resolveNhlId({ nhlId: null, fantraxId: null, name: "Joe Goalie", position: "C" }, ctx), { id: null, via: null }, "skater never matches a goalie");
eq(resolveNhlId({ nhlId: null, fantraxId: null, name: "Joe Goalie", position: "G" }, ctx).id, 8480002, "goalie matches goalie");
eq(resolveNhlId({ nhlId: "42", fantraxId: null, name: "Nobody" }, ctx), { id: null, via: null }, "bogus direct id ignored");
eq(normalizePosition("Default"), null, "odd position dropped");
eq(normalizePosition("lw"), "LW", "position uppercased");
eq(normalizeTeam("(N/A)"), null, "N/A team dropped");
eq(normalizeTeam("MTL"), "MTL", "team kept");

// ---- shards
eq(fnv1a32(""), 0x811c9dc5, "fnv offset basis");
eq(fnv1a32("a"), 0xe40c292c, "fnv('a')");
const keys = Array.from({ length: 2000 }, (_, i) => `fx:${i.toString(36)}`);
const buckets = new Array(SNAKE_SHARD_COUNT).fill(0) as number[];
for (const k of keys) {
  const s = snakeShardOf(k);
  assert(s >= 0 && s < SNAKE_SHARD_COUNT && Number.isInteger(s), `shard in range for ${k}`);
  buckets[s]!++;
}
assert(Math.min(...buckets) > 0, "every shard used by 2000 keys");
assert(Math.max(...buckets) < (2000 / SNAKE_SHARD_COUNT) * 2.5, "shards reasonably balanced");
eq(snakeShardOf("fx:05wwg"), snakeShardOf("fx:05wwg"), "deterministic");
eq(snakeShardFile(7), "o/07.json", "shard file name");
eq(snakeShardFileForKey("fx:05wwg"), snakeShardFile(snakeShardOf("fx:05wwg")), "key → file");

// ---- build on a fixture
function sop(o: Partial<SourceOpinion>): SourceOpinion {
  return {
    videoId: "vid00000001",
    date: "2026-09-01",
    show: "Processus",
    title: "Épisode",
    url: "https://www.youtube.com/watch?v=vid00000001&t=60s",
    timestamps: ["00:01:00", "00:02:00"],
    contextAtTime: "Canadiens",
    opinionFr: "Il l'aime « beaucoup » pour sa vitesse.",
    stance: "positif",
    projection: null,
    strengths: ["vitesse"],
    weaknesses: [],
    comparables: [],
    rankMentions: [],
    attribution: "certain",
    nameConfidence: "haute",
    ...o,
  };
}
function sp(p: Partial<SourcePlayer> & { key: string }): SourcePlayer {
  return {
    name: "Joueur",
    fantraxId: null,
    nhlId: null,
    position: "C",
    team: "MTL",
    draft: null,
    opinions: [],
    synthesis: {
      syntheseFr: "Il l'aime pour sa vitesse. Une opinion incertaine dit le contraire.",
      verdict: "positif",
      tendance: "en hausse",
      projection: "Top 6",
      forces: ["vitesse"],
      faiblesses: [],
      comparables: [],
      contradictions: "Une opinion d'attribution incertaine le trouve lent.",
    },
    ...p,
  };
}
const fixture: SourceDb = {
  builtAt: "2026-09-25T00:00:00.000Z",
  scout: "Simon « Snake » Boisvert",
  stats: { videos: 4, videosWithSnake: 3 },
  videos: {
    vid00000001: { title: "Épisode 1", show: "Processus", date: "2026-09-01", url: "https://www.youtube.com/watch?v=vid00000001", snakePresent: true },
    vid00000002: { title: "Épisode 2", show: "Trust The Process", date: "2025-01-10", url: "https://www.youtube.com/watch?v=vid00000002", snakePresent: true },
    vid00000003: { title: "Sans Snake", show: "Processus", date: "2026-09-20", url: "https://www.youtube.com/watch?v=vid00000003", snakePresent: false },
    vid00000004: { title: "Snake reçu", show: "Invité", channel: "Le Retour Avec Martin Lemay", date: "2026-09-18", url: "https://www.youtube.com/watch?v=vid00000004", snakePresent: true },
  },
  players: [
    sp({
      key: "fx:aaa",
      name: "Alpha Un",
      fantraxId: "aaa",
      nhlId: "8480010",
      draft: "2022 #62 MTL",
      opinions: [
        sop({ projection: "Top 6", rankMentions: [{ list: "Top 2", rank: 1 }] }),
        sop({ url: "https://www.youtube.com/watch?v=vid00000001&t=300s", timestamps: ["00:05:00"] }),
        sop({ videoId: "vid00000002", date: "2025-01-10", show: "Trust The Process", url: "https://www.youtube.com/watch?v=vid00000002", timestamps: ["00:10:00"], attribution: "probable", stance: "mitigé" }),
        sop({ videoId: "vid00000003", date: "2026-09-20", attribution: "certain" }), // Snake absent → invalid
      ],
    }),
    sp({ key: "fx:bbb", name: "Beta Deux", fantraxId: "bbb", opinions: [sop({ attribution: "incertain" })] }),
    sp({
      key: "nhl:8480010",
      name: "Alpha 1",
      nhlId: "8480010",
      opinions: [sop({ videoId: "vid00000002", date: "2025-01-10", url: "https://www.youtube.com/watch?v=vid00000002&t=30s", timestamps: ["00:00:30"] })],
    }),
    sp({
      key: "name:gamma trois",
      name: "Gamma Trois",
      opinions: [
        sop({ attribution: "probable", opinionFr: "Il le trouve bon.", date: "2026-09-04" }),
        sop({ attribution: "certain", opinionFr: "Il le juge moyen.", stance: "mitigé", date: "2026-08-01", videoId: "vid00000004", url: "https://www.youtube.com/watch?v=vid00000004&t=0s", timestamps: ["00:00:00", "00:12:00"] }),
        sop({ attribution: "incertain", date: "2026-09-02" }),
        sop({ attribution: "incertain", date: "2026-09-03" }),
      ],
    }),
    // Filed under the wrong player, then fixed by hand.
    sp({
      key: "fx:ddd",
      name: "Delta Quatre",
      fantraxId: "ddd",
      nhlId: "8480020",
      position: "G",
      opinions: [
        sop({ opinionFr: "Il le trouve rapide." }),
        sop({ videoId: "vid00000002", date: "2025-01-10", opinionFr: "C'est un joueur de 3e trio." }),
        sop({ videoId: "vid00000004", date: "2026-09-18", url: "https://www.youtube.com/watch?v=vid00000004&t=100s", opinionFr: "Texte à reformuler." }),
        sop({ date: "2026-09-01", url: "https://www.youtube.com/watch?v=vid00000001&t=900s", opinionFr: "Il aime sa vitesse." }),
      ],
      synthesis: {
        syntheseFr: "Il le trouve rapide. C'est un joueur de 3e trio.",
        verdict: "positif",
        tendance: "stable",
        projection: null,
        forces: [],
        faiblesses: [],
        comparables: [],
        contradictions: null,
      },
    }),
  ],
  rankings: [
    { videoId: "vid00000001", date: "2026-09-01", show: "Processus", title: "Top « 2 »", entries: [{ rank: 2, player: "Gamma Trois" }, { rank: 1, player: "Alpha Un" }, { rank: 3, player: "Inconnu" }] },
    { videoId: "vid00000003", date: "2026-09-20", show: "Processus", title: "Pas de Snake", entries: [{ rank: 1, player: "Alpha Un" }] },
    { videoId: "vid00000001", date: "2026-09-01", show: "Processus", title: "Top 5 (discussion conjointe, attribution incertaine)", entries: [{ rank: 1, player: "Alpha Un" }] },
    { videoId: "vid00000001", date: "2026-09-01", show: "Processus", title: "Top 3 (2e rang déduit)", entries: [{ rank: 1, player: "Alpha Un" }] },
    { videoId: "vid00000004", date: "2026-09-18", show: "Invité", title: "Favoris (ordre de mention, pas un classement)", entries: [{ rank: 1, player: "Zeta" }] },
  ],
};
const built = buildSnakePublicData(fixture, {
  fantraxToNhl: { eee: 8480020 },
  boardByName: buildBoardNameIndex([{ id: 8480010, name: "Alpha Un" }]),
  boardIds: new Set([8480010, 8480020]),
  boardPlayers: new Map([[8480020, { pos: "D", team: "EDM" }]]),
  shardCount: 4,
  corrections: [
    { key: "fx:ddd", vid: "vid00000002", drop: "wrong player" },
    { key: "fx:ddd", vid: "vid00000004", set: { opinionFr: "Texte reformulé." }, wording: true },
  ],
  synthesisCorrections: {},
  rankingTitleCorrections: {},
});
const listByKey = new Map(built.index.rows.map((r) => [r.k, r]));
const shardRow = (k: string) => built.shards[snakeShardOf(k, 4)]!.players[k]!;
eq([...listByKey.keys()].sort(), ["fx:aaa", "fx:ddd", "name:gamma trois"], "incertain-only player dropped, duplicate NHL record merged");
eq(built.index.aliases, { "nhl:8480010": "fx:aaa" }, "merged record aliased");
eq(built.shards[snakeShardOf("nhl:8480010", 4)]!.aliases, { "nhl:8480010": "fx:aaa" }, "alias listed in its own shard (deep links resolve without the index)");
const alpha = shardRow("fx:aaa").r;
eq([alpha.oc, alpha.vc, alpha.pc], [4, 2, 1], "counts after merge (Snake-absent video dropped)");
eq([alpha.fs, alpha.ls, alpha.l], ["2025-01-10", "2026-09-01", "positif"], "dates and latest stance");
eq(alpha.s, "Il l'aime pour sa vitesse.", "synthesis scrubbed of the uncertain sentence");
eq([alpha.x, alpha.tr, alpha.dv], [null, undefined, undefined], "one input of four dropped, nothing only it supported → synthesis kept as is");
eq([alpha.nhl, alpha.b], [8480010, 1], "NHL id + on the board");
eq(alpha.dr, "2022, 62e choix (MTL)", "draft line in French");
assert(!alpha.pr, "mixed attribution, not probable-only");
const gamma = shardRow("name:gamma trois").r;
eq([gamma.dv, gamma.pr, gamma.oc], [1, undefined, 2], "2 of 4 uncertain → synthesis withheld");
eq([gamma.s, gamma.v, gamma.sd], ["Il le juge moyen.", "mitigé", "2026-08-01"], "stand-in = latest certain opinion, not the newer probable one");
eq(gamma.td, "inconnue", "no trend without a synthesis");
const gammaOps = shardRow("name:gamma trois").o;
eq(gammaOps.map((o) => [o.d, o.t, o.ts ?? []]), [["2026-09-04", 60, [120]], ["2026-08-01", 720, []]], "0:00 start skipped for the passage");
const delta = shardRow("fx:ddd");
eq([delta.r.fx, delta.r.pos, delta.r.tm], ["eee", "D", "EDM"], "Fantrax id / position / team follow the NHL id, not a namesake's");
eq(delta.o.map((o) => o.o), ["Texte reformulé.", "Il le trouve rapide.", "Il aime sa vitesse."], "hand drop and rewording applied");
eq([delta.r.dv, delta.r.tr, delta.r.s], [undefined, 1, "Il le trouve rapide."], "what only the hand-dropped opinion said is trimmed from the synthesis");
eq(built.report.identityFixed, ["fx:ddd: Fantrax ddd → eee"], "identity fix reported");
eq(built.report.unusedCorrections, [], "every fixture correction used");
eq(built.index.stats.filtered.opinionsUncertainAttribution, 3, "uncertain opinions counted");
eq(built.index.stats.filtered.opinionsLowNameConfidence, 1, "hand-dropped opinion counted as a doubtful player");
eq(built.index.stats.filtered.opinionsInvalid, 1, "Snake-absent video counted as invalid");
eq(built.index.stats.filtered.playersWithoutPublishableOpinion, 1, "dropped player counted");
eq([built.index.stats.filtered.synthesesWithheld, built.index.stats.filtered.synthesesTrimmed], [1, 1], "withheld / trimmed counted");
eq(built.index.shows, ["Processus", "Le Retour avec Martin Lemay (Snake invité)", "Trust The Process"], "guest spots name the host program");
eq(showLabel({ show: "Invité", channel: null }), "Snake invité", "guest spot without a channel");
const alphaList = listByKey.get("fx:aaa")!;
eq(Object.keys(alphaList).sort(), ["dv", "fx", "k", "ls", "m", "n", "oc", "pos", "pr", "s", "td", "tm", "v"].filter((k) => k in alphaList).sort(), "slim index row");
assert(!("f" in alphaList) && !("x" in alphaList) && !("nhl" in alphaList), "index rows carry no synthesis detail");
eq(alphaList.m?.length, 8, "mention list = 2 numbers per opinion");
let inShards = 0;
built.shards.forEach((s, i) => {
  for (const [k, v] of Object.entries(s.players)) {
    inShards++;
    eq(snakeShardOf(k, 4), i, `${k} in its shard`);
    assert(!("m" in v.r), "shard rows carry no mention list");
    for (const o of v.o) assert(!!s.videos[o.vid], `video ${o.vid} described in its shard`);
  }
});
eq(inShards, 3, "every published player sharded once");
const alphaOps = shardRow("fx:aaa").o;
eq(
  alphaOps.map((o) => [o.d, o.t, o.p ?? 0]),
  [["2026-09-01", 60, 0], ["2026-09-01", 300, 0], ["2025-01-10", 30, 0], ["2025-01-10", 600, 1]],
  "timeline newest first, merged, deep-link seconds",
);
eq(alphaOps[0]!.ts, [120], "other passages kept, start excluded");
eq(alphaOps[0]!.o, "Il l'aime beaucoup pour sa vitesse.", "opinion unquoted");
const allText = JSON.stringify(built);
assert(!/incertain/.test(allText.replace(/opinionsUncertainAttribution/g, "")), "no uncertain material anywhere in the output");
eq(built.rankings.rankings.map((r) => r.ti), ["Favoris (ordre de mention, pas un classement)", "Top 2"], "Snake-absent, uncertain and deduced rankings dropped");
eq(built.report.rankingsWithheld, 2, "uncertain + deduced rankings counted");
const top2 = built.rankings.rankings.find((r) => r.ti === "Top 2")!;
eq(top2.e, [[1, "Alpha Un", "fx:aaa"], [2, "Gamma Trois", "name:gamma trois"], [3, "Inconnu", null]], "ranking sorted and linked");
eq(top2.t, 60, "ranking timed at the published opinion stating that rank");
eq([top2.u, built.rankings.rankings[0]!.u, built.rankings.rankings[0]!.t], [undefined, 1, 0], "order-of-mention list flagged; untimed list → whole video");
eq(built.nhl.rows["8480010"]?.[0], "fx:aaa", "NHL lookup → merged key");
eq(built.fantrax.rows["aaa"]?.slice(0, 3), ["fx:aaa", "positif", "en hausse"], "Fantrax lookup");
eq(built.fantrax.rows["eee"]?.[0], "fx:ddd", "Fantrax lookup under the fixed id");
eq(built.summary.fx["aaa"], "fx:aaa", "summary Fantrax map");
eq(built.summary.rows["name:gamma trois"]?.[3], 0, "summary carries the probable flag");
eq(standInOpinion([{ p: 1, o: "a" } as SnakeOpinion, { o: "b" } as SnakeOpinion]).o, "b", "stand-in prefers a certain opinion");
eq(standInOpinion([{ p: 1, o: "a" } as SnakeOpinion]).o, "a", "stand-in falls back to the latest");

// ---- /league seed
eq(
  snakeFantraxSeed({ players: { aaa: {} }, waivers: { targets: [{ id: "zzz" }] }, draft: null }, built.summary),
  { aaa: ["fx:aaa", "positif", "en hausse", "Il l'aime pour sa vitesse.", 0] },
  "seed only carries plan players Snake discussed",
);

// ---- verbatim guard
eq(verbatimWords("L'équipe « gagne »"), ["l", "equipe", "gagne"], "folded words");
eq(transcriptWords("# titre\n[00:00:01] Bonjour à tous\n[00:00:05] et bienvenue"), ["bonjour", "a", "tous", "et", "bienvenue"], "transcript words");
{
  const g = ngramSet(verbatimWords("il faudrait qu'il soit dominant et il ne l'est pas du tout selon lui"), 10);
  eq(longestSharedRun("Il faudrait qu'il soit dominant, et il ne l'est pas du tout.", [g], 10).length, 14, "run found across punctuation");
  eq(longestSharedRun("Pour y arriver, il devrait dominer, ce qui est loin d'être le cas.", [g], 10).length, 0, "paraphrase passes");
}

// ---- list filters
const row = (o: Partial<SnakeListRow> & { k: string }): SnakeListRow => ({
  n: o.k,
  pos: "C",
  tm: "MTL",
  fx: null,
  v: "positif",
  td: "stable",
  s: "",
  oc: 1,
  ls: "2026-01-01",
  m: [0, epochDay("2026-01-01")],
  ...o,
});
const rows: SnakeListRow[] = [
  row({ k: "a", n: "Lane Hutson", pos: "D", v: "très positif", oc: 3, ls: "2026-09-22", fx: "05wwg", m: [0, epochDay("2026-09-22"), 1, epochDay("2025-03-01"), 1, epochDay("2024-01-01")] }),
  row({ k: "b", n: "Ivan Demidov", pos: "RW", v: "très positif", oc: 5, ls: "2026-09-01", m: [1, epochDay("2026-09-01")] }),
  row({ k: "c", n: "Kirby Dach", pos: "C", v: "négatif", td: "en baisse", oc: 2, ls: "2025-02-01", m: [2, epochDay("2025-02-01")] }),
  row({ k: "d", n: "Jakub Dobeš", pos: "G", tm: null, v: "mitigé", oc: 1, ls: "2024-05-01", m: [0, epochDay("2024-05-01")] }),
];
const fctx = { refDate: "2026-09-25T00:00:00Z", myFantraxIds: new Set(["05wwg"]) };
const run = (p: Partial<typeof DEFAULT_SNAKE_FILTERS>) =>
  sortSnakeItems(filterSnakeRows(rows, { ...DEFAULT_SNAKE_FILTERS, ...p }, fctx), p.sort ?? "opinions").map((i) => i.row.k);
eq(run({}), ["b", "a", "c", "d"], "default sort: opinion count");
eq(run({ query: "dobes" }), ["d"], "accent-insensitive search");
eq(run({ query: "hut la" }), ["a"], "every token must match");
eq(run({ query: "mtl" }), ["b", "a", "c"], "team code search");
eq(run({ verdict: "très positif" }), ["b", "a"], "verdict filter");
eq(run({ trend: "en baisse" }), ["c"], "trend filter");
eq(run({ position: "F" }), ["b", "c"], "forwards");
eq(run({ position: "G" }), ["d"], "goalies");
eq(run({ team: "-" }), ["d"], "no NHL team");
eq(run({ mine: true }), ["a"], "my Fantrax team");
eq(run({ show: 1 }), ["a", "b"], "show filter, ranked by matching mentions then count");
eq(run({ period: "30" }), ["b", "a"], "last 30 days");
eq(run({ period: "s:2024-25" }), ["a", "c"], "season filter");
eq(run({ show: 1, period: "s:2024-25" }), ["a"], "show and period on the same mention");
eq(run({ sort: "recent" }), ["a", "b", "c", "d"], "sort by last mention");
eq(run({ sort: "verdict-neg" }), ["c", "d", "b", "a"], "most negative first");
eq(run({ sort: "name" }), ["b", "d", "c", "a"], "name A→Z (accents folded)");
eq(mentionCount(rows[0]!, 1, null), 2, "mentions in a show");
eq(periodRange("", "2026-09-25"), null, "no period");
eq(periodRange("s:2025-26", "2026-09-25"), [epochDay("2025-07-01"), epochDay("2026-06-30")], "season range");
eq(activeSnakeFilterCount({ ...DEFAULT_SNAKE_FILTERS, query: "x", mine: true, show: 0 }), 2, "search is not a filter");

// ---- URL / copy
eq(snakePlayerHref("fx:05wwg"), "/snake?p=fx%3A05wwg", "player href");
eq(snakeSearch("?x=1", "k"), "?x=1&p=k", "search keeps other params");
eq(snakeSearch("?p=k", null), "", "close drops p");
eq(snakeKeyFromSearch("?p=fx%3A05wwg"), "fx:05wwg", "key from search");
eq(snakeKeyFromSearch("?p=%20"), null, "blank key");
eq(youtubeHref("C0ZYFRVjXQU", 909), "https://www.youtube.com/watch?v=C0ZYFRVjXQU&t=909s", "deep link");
eq(youtubeHref("C0ZYFRVjXQU", 0), "https://www.youtube.com/watch?v=C0ZYFRVjXQU", "video start");
eq(formatClock(909), "15:09", "clock");
eq(formatClock(3725), "1:02:05", "clock with hours");
{
  const prevBase = process.env.NEXT_PUBLIC_BASE_PATH;
  process.env.NEXT_PUBLIC_BASE_PATH = "/fantasy-hockey-vor";
  eq(snakeDataHref("o/07.json", "abc123"), "/fantasy-hockey-vor/snake/o/07.json?v=abc123", "data URL on Pages, versioned by content");
  eq(boardPlayerHref(8483457), "/fantasy-hockey-vor/?player=8483457#rankings", "board link carries the basePath (plain <a>)");
  delete process.env.NEXT_PUBLIC_BASE_PATH;
  eq(snakeDataHref("index.json", ""), "/snake/index.json", "data URL locally, unversioned");
  eq(boardPlayerHref(8483457), "/?player=8483457#rankings", "board link locally");
  if (prevBase !== undefined) process.env.NEXT_PUBLIC_BASE_PATH = prevBase;
}
eq(formatSnakeDate("2026-09-22"), `22${NB}sept.${NB}2026`, "French date");
eq(formatSnakeDate("2026-08-01"), `1${NB}août${NB}2026`, "août");
eq(formatCountFr(9263), `9${NB}263`, "French grouping");
eq(plural(1, "opinion", "opinions"), `1${NB}opinion`, "singular");
eq(plural(1272, "joueur", "joueurs"), `1${NB}272${NB}joueurs`, "plural");
eq(formatDraftFr("2022 #62 MTL"), "2022, 62e choix (MTL)", "draft in French");
eq(formatDraftFr("2019 #1 NJD"), "2019, 1er choix (NJD)", "first overall");
eq(seasonOf("2026-09-22"), "2026-27", "season after July 1");
eq(seasonOf("2026-03-01"), "2025-26", "season before July 1");
assert(stanceScore("très positif") > stanceScore("positif") && stanceScore("négatif") > stanceScore("très négatif"), "stance order");
eq(snakeVerdictAria("positif", "en hausse", true), "Avis de Snake : positif, en hausse (attribution probable)", "chip label");
eq(snakeVerdictAria("mitigé", "en baisse", false, "JJ Peterka"), "Avis de Snake sur JJ Peterka : mitigé, en baisse", "named chip label reads in order");
eq(snakeVerdictAria("mitigé", "inconnue"), "Avis de Snake : mitigé", "unknown trend omitted");
assert(snakeDerivedNote("2026-08-01", false).includes("attribution est certaine"), "stand-in note says the opinion is a certain one");
assert(!snakeDerivedNote("2026-08-01", true).includes("certaine"), "probable-only stand-in note makes no certainty claim");
for (const needle of ["non officiels", "sous-titres automatiques", "paraphrases", "pas des citations", "erreurs de transcription", "attribution", "Aucune affiliation", "Écoutez la source"]) {
  assert(SNAKE_DISCLAIMER_SHORT.includes(needle), `short disclaimer mentions "${needle}"`);
}
const full = SNAKE_DISCLAIMER_FULL.join(" ");
for (const needle of ["pas officielle", "sous-titres automatiques", "paraphrases", "pas des citations", "erreurs de transcription", "attribution", "aucune affiliation", "écoutez la source"]) {
  assert(full.toLowerCase().includes(needle.toLowerCase()), `full disclaimer mentions "${needle}"`);
}
assert(!full.includes("mot pour mot"), "the full disclaimer makes no word-for-word promise the data cannot back");

// ---- board / nav wiring
eq(
  boardRowAriaLabel({ name: "Lane Hutson", rank: 45 }, "ALL", 0, snakeBoardRowSuffix("très positif", "en hausse", true)),
  "Lane Hutson, rank 45, Snake: very positive, trending up (probable attribution)",
  "row label suffix in English, with trend and probable attribution",
);
eq(snakeBoardRowSuffix("mitigé", "inconnue"), "Snake: mixed", "unknown trend omitted");
eq(boardRowAriaLabel({ name: "Lane Hutson", rank: 45 }, "ALL", 0), "Lane Hutson, rank 45", "row label unchanged without Snake");
eq(siteNavLinks().map((l) => l.href), ["/league", "/snake"], "nav links");
assert(siteNavLinks().every((l) => l.label.endsWith("(FR)") && l.hrefLang === "fr-CA"), "nav flags the French pages");

if (failed) process.exit(1);
console.log("OK: snake data (filters, tracing, corrections, id resolution, shards, build, verbatim guard, list filters, copy)");

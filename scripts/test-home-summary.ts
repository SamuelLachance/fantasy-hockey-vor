/**
 * Unit checks for the « Mes ligues » cards: exact wording on synthetic
 * plans, invariants only on the committed (twice-daily) data.
 * Run: npx tsx scripts/test-home-summary.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import type { DailyPlan } from "../src/lib/fantrax/daily-plan";
import { teamDynastySummary } from "../src/lib/fantrax/dynasty-hints";
import { parseDynasty } from "../src/lib/fantrax/dynasty-index";
import { categoryHomeCard, dynastyHomeNote, fantraxHomeCard, snakeHomeCard } from "../src/lib/leagues/home-summary";
import { getLeague } from "../src/lib/leagues/registry";

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
const load = <T>(...parts: string[]) => JSON.parse(readFileSync(join(process.cwd(), ...parts), "utf8")) as T;

const captains = getLeague("captains-dynasty")!;
const ltl = getLeague("light-the-lamp")!;

type HomePlan = Parameters<typeof fantraxHomeCard>[1];
const base: HomePlan = {
  teamName: "Quebec Trashers",
  dataAsOf: "2026-09-25T18:15:00.000Z",
  legality: {
    illegal: false,
    need: 0,
    minTotal: 15,
    counts: { active: 15, reserve: 2, ir: 0, minors: 10, counted: 17 },
  } as DailyPlan["legality"],
  alerts: [],
  draft: null,
  target: { rosterPeriod: 1, start: "2026-09-29T21:00:00.000Z", end: "2026-09-30T23:29:59.000Z", date: "2026-09-29" },
  players: { p1: { n: "Chase Reid", t: "SJS", e: "D", st: "ACTIVE", fpg: 1, src: "proj" } },
};

// ---- a quiet day
{
  const card = fantraxHomeCard(captains, base);
  eq(card.title, "Captains Dynasty League", "title");
  eq(card.chips, ["Fantrax", "Dynastie", "Points", `16${NB}équipes`], "chips");
  eq(card.myTeam, "Quebec Trashers", "my team");
  eq(card.alerts, [], "no alerts");
  eq(card.syncedText, `À la synchro du ven. 25${NB}sept., 14${NB}h${NB}15 (HAE)`, "dated by the sync");
  eq(card.search, `?team=${captains.myTeamId}`, "links carry my team (not the one last looked at)");
  eq(card.dates.map((d) => [d.label, d.text]), [["Prochain verrouillage", `mar. 29${NB}sept., 17${NB}h (HAE)`]], "next lock");
  eq(card.tabs.map((t) => t.tab), captains.tabs, "one link per tab");
  eq(card.defaultTab, "aujourdhui", "title links to the default tab");
}

// ---- an illegal roster, empty slots, a dead active player, the draft running
{
  const card = fantraxHomeCard(captains, {
    ...base,
    legality: {
      illegal: true,
      need: 3,
      minTotal: 15,
      counts: { active: 12, reserve: 0, ir: 1, minors: 29, counted: 12 },
    } as DailyPlan["legality"],
    alerts: [
      { level: "error", code: "illegal-roster", count: 12, limit: 15 },
      { level: "error", code: "dead-active", ids: ["p1"], slot: "D", detail: "minor-leagues", to: "RESERVE" },
      { level: "warn", code: "empty-slot", slot: "C", count: 1 },
      { level: "warn", code: "empty-slot", slot: "D", count: 2 },
    ],
    draft: {
      state: "running",
      made: 23,
      total: 224,
      current: { pick: 24, round: 2, teamId: "x" },
      next: { pick: 27, round: 2, teamId: "me" },
      following: { pick: 30, round: 2, teamId: "me" },
      picksBefore: 3,
    } as unknown as DailyPlan["draft"],
  });
  const texts = card.alerts.map((a) => [a.level, a.tab, a.hash ?? null, a.text]);
  eq(texts.length, 4, "four lines");
  // The running draft first, with its time in the line (the picks move fast).
  eq(
    texts[0],
    ["info", "repechage", null, `Repêchage en cours. À 14${NB}h${NB}15, votre choix n°${NB}27 était dans 3 choix : suivez-le en direct.`],
    "draft line first, dated",
  );
  assert(String(texts[1]?.[3]).startsWith("Alignement illégal : 12/15") && texts[1]?.[0] === "error", "then the illegal roster");
  eq(texts[1]?.slice(1, 3), ["aujourdhui", "alertes"], "legality → Aujourd'hui#alertes");
  assert(String(texts[2]?.[3]).includes("Chase Reid") && String(texts[2]?.[3]).includes("réserve"), "dead player named, with the move");
  eq(texts[3], ["warn", "aujourdhui", "alignement", "1 poste C vide · 2 postes D vides."], "empty slots on one line");
}

// ---- on the clock / no pick left / not started
{
  const draft = (over: object) =>
    fantraxHomeCard(captains, {
      ...base,
      draft: {
        state: "running",
        current: { pick: 27, round: 2, teamId: "me" },
        next: { pick: 27, round: 2, teamId: "me" },
        picksBefore: 0,
        ...over,
      } as unknown as DailyPlan["draft"],
    }).alerts.at(-1);
  eq(
    draft({})?.text,
    `Repêchage en cours. À 14${NB}h${NB}15, c’était votre tour (choix n°${NB}27, 2e ronde) : suivez-le en direct.`,
    "on the clock (at the sync)",
  );
  eq(draft({})?.level, "warn", "on the clock stands out");
  eq(draft({ next: null })?.text, "Repêchage en cours : vous n’avez plus de choix.", "no pick left");
  eq(draft({ state: "not-started" })?.text, "Le repêchage de la ligue n’a pas encore commencé.", "not started");
  eq(fantraxHomeCard(captains, { ...base, draft: { state: "done" } as unknown as DailyPlan["draft"] }).alerts, [], "done: silent");
  eq(fantraxHomeCard(captains, { ...base, target: null }).dates, [], "no lock known");
}

// ---- Light the Lamp (stable league config)
{
  const profile = load<{ draft: { startsAt: string; rounds: number; pickSeconds: number } }>(
    "src",
    "data",
    "leagues",
    "light-the-lamp.json",
  );
  const card = categoryHomeCard(ltl, profile);
  eq(card.chips, ["Yahoo", "Saison unique", "Catégories", `12${NB}équipes`], "Yahoo chips");
  eq(card.scoringTitle, "Têtes-à-têtes par catégories", "scoring meaning");
  eq(card.dates[0]?.text, `dimanche 27 septembre 2026, 14${NB}h (HAE)`, "draft date in French");
  eq(card.dates[0]?.iso, profile.draft.startsAt, "draft instant");
  eq(card.alerts, [], "no baked alert: the draft lives on the device");
  eq(card.syncedText, null, "nothing baked to date");
  eq(card.search, "", "no team in the links");
  eq(
    card.dates[0]?.endIso,
    new Date(Date.parse(profile.draft.startsAt) + 12 * 3600_000).toISOString(),
    "« terminé » 12 h after the start",
  );
  eq(card.dates[0]?.endLabel, "terminé", "draft over label");
  eq(card.tabs.map((t) => t.label), ["Repêchage", "Joueurs", "Mon équipe", "Duel de la semaine"], "tab labels");
}

// ---- the dynasty line (2027 cutdown against my 10 keeper slots)
{
  eq(fantraxHomeCard(captains, base).note, null, "no dynasty data: no line");
  const s = { core: 5, bubble: 6, tradeBefore: 3, text: "5 à protéger, 6 à décider, 6 en location, 28 gratuits (mineures)" };
  eq(
    fantraxHomeCard(captains, base, s).note,
    {
      text: "Écrémage 2027 : 6 à décider pour 5 places · 3 joueurs en location à échanger avant l’écrémage.",
      tab: "mon-equipe",
      hash: "ecremage",
    },
    "decisions and rentals, linked to Mon équipe",
  );
  eq(dynastyHomeNote({ core: 9, bubble: 1, tradeBefore: 1, text: "" }).text, "Écrémage 2027 : 1 à décider pour 1 place · 1 joueur en location à échanger avant l’écrémage.", "singulars");
  eq(dynastyHomeNote({ core: 4, bubble: 0, tradeBefore: 0, text: "4 à protéger, 0 à décider, 0 en location, 3 gratuits (mineures)" }).text, "Écrémage 2027 : 4 à protéger, 0 à décider, 0 en location, 3 gratuits (mineures).", "nothing to decide: the summary");
  eq(categoryHomeCard(ltl, { draft: { startsAt: "2026-09-27T18:00:00.000Z", rounds: 18, pickSeconds: 75 } }).note, null, "categories league: no line");
  // The committed files (same sync): my roster is covered.
  const idx = parseDynasty(load<unknown>("public", "fantrax", "dynasty.json"));
  const st = load<{ rosters: Record<string, Array<{ id: string }>> }>("public", "fantrax", "state.json");
  const sum = teamDynastySummary((st.rosters[captains.myTeamId] ?? []).map((e) => idx?.byFantrax.get(e.id) ?? null));
  eq(sum.unknown, 0, "committed dynasty.json covers my roster");
  assert(fantraxHomeCard(captains, base, sum).note!.text.startsWith("Écrémage 2027 : "), "committed data: a dynasty line");
}

// ---- Snake card
eq(
  snakeHomeCard({ stats: { players: 1272, opinions: 9255, lastDate: "2026-09-24" } }).text,
  `1${NB}272${NB}joueurs · 9${NB}255${NB}opinions · dernier épisode le 24${NB}sept.${NB}2026`,
  "Snake line",
);

// ---- invariants on the committed plan (it changes twice a day)
{
  const today = load<DailyPlan>("src", "data", "fantrax", "today.json");
  const card = fantraxHomeCard(captains, today);
  const text = JSON.stringify(card);
  assert(card.alerts.every((a) => a.text.length > 0 && captains.tabs.includes(a.tab)), "committed plan: well-formed alerts");
  assert(!/owner/i.test(text), "no owner names");
  assert(!/\b(the|and|pick|roster|lineup|waivers?)\b/i.test(card.alerts.map((a) => a.text).join(" ")), "French only");
  assert(card.syncedText?.startsWith("À la synchro du") ?? false, "committed plan: dated");
}

if (failed) process.exit(1);
console.log("OK: home summary (Mes ligues cards)");

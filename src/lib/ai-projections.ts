import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { writeFileAtomic } from "./atomic-write";
import { PROJECTION_SEASON } from "./nhl-api";
import type {
  AiGoalieProjection,
  AiProjectionCache,
  AiSkaterProjection,
  PlayerProfile,
} from "./profile-types";

const DEFAULT_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
const BATCH_SIZE = 6;

const SKATER_SCHEMA = `{
  "players": [{
    "id": number,
    "gamesPlayed": number,
    "goals": number, "assists": number, "shots": number, "blocks": number,
    "hits": number, "powerplayPoints": number, "penaltyMinutes": number, "faceoffWins": number,
    "confidence": number (0-1),
    "reasoning": string (2-3 sentences citing team change, age, injury, usage, draft pedigree)
  }]
}`;

const GOALIE_SCHEMA = `{
  "players": [{
    "id": number,
    "gamesPlayed": number,
    "wins": number, "shutouts": number, "saves": number, "savePct": number (0.000-1.000),
    "confidence": number (0-1),
    "reasoning": string
  }]
}`;

function cachePath(): string {
  return join(process.cwd(), "src", "data", "ai-projections.json");
}

export function loadAiCache(): AiProjectionCache | null {
  const path = cachePath();
  if (!existsSync(path)) return null;
  const cache = JSON.parse(readFileSync(path, "utf8")) as AiProjectionCache;
  if (cache.season !== PROJECTION_SEASON) {
    console.warn(
      `WARN: ignoring ai-projections.json for season ${cache.season} (projecting ${PROJECTION_SEASON}).`,
    );
    return null;
  }
  return cache;
}

export function saveAiCache(cache: AiProjectionCache): void {
  writeFileAtomic(cachePath(), JSON.stringify(cache, null, 2));
}

function buildSkaterPrompt(profiles: PlayerProfile[]): string {
  const dossiers = profiles.map((p) => ({
    id: p.id,
    narrative: p.contextNarrative,
    bio: p.bio,
    draft: p.draft,
    teamContext: p.teamContext,
    injury: p.injury,
    contract: p.contract,
    last3Seasons: p.teamHistory.slice(-3),
    advancedLatest: p.advancedSeasonLatest,
    last5Games: p.last5Games,
    awards: p.awards,
  }));

  return `You are an elite NHL fantasy hockey analyst. Project the ${PROJECTION_SEASON} regular season for a head-to-head CATEGORIES league.

Categories for skaters: goals, assists, shots, blocks, hits, powerplay points, penalty minutes, faceoff wins.

Use ALL context: age, height/weight, handedness, draft pedigree, team strength & recent form, team changes, injury/durability history, contract stage motivation, advanced usage (SAT, zone starts), trend from prior seasons, linemate/team offense environment.

Predict realistic full-season category totals (not per-game). Skaters are projected for an 82-game season. Goalies are projected for a starter workload (typically 20-58 games), not a full 82-game season.

Return ONLY valid JSON matching: ${SKATER_SCHEMA}

Players:
${JSON.stringify(dossiers, null, 2)}`;
}

function buildGoaliePrompt(profiles: PlayerProfile[]): string {
  const dossiers = profiles.map((p) => ({
    id: p.id,
    narrative: p.contextNarrative,
    bio: p.bio,
    draft: p.draft,
    teamContext: p.teamContext,
    injury: p.injury,
    contract: p.contract,
    last3Seasons: p.teamHistory.slice(-3),
    last5Games: p.last5Games,
  }));

  return `You are an elite NHL fantasy goalie analyst. Project ${PROJECTION_SEASON} for categories: wins, shutouts, saves, save percentage.

Use team quality, expected games started based on recent workload (not injuries), age, platoon risk, team defensive environment. Project 20-58 games for goalies depending on role.

Return ONLY valid JSON matching: ${GOALIE_SCHEMA}

Goalies:
${JSON.stringify(dossiers, null, 2)}`;
}

async function callOpenAi(prompt: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      temperature: 0.35,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You produce conservative, data-driven NHL stat projections. Output JSON only.",
        },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  return data.choices[0]?.message?.content ?? "{}";
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function runAiProjections(
  profiles: PlayerProfile[],
  options: { limit?: number; force?: boolean } = {},
): Promise<AiProjectionCache> {
  const existing = options.force ? null : loadAiCache();
  const cache: AiProjectionCache = existing ?? {
    model: DEFAULT_MODEL,
    season: PROJECTION_SEASON,
    generatedAt: new Date().toISOString(),
    skaters: {},
    goalies: {},
  };

  const skaters = profiles
    .filter((p) => !p.isGoalie)
    .filter((p) => options.force || !cache.skaters[p.id])
    .slice(0, options.limit ?? Infinity);

  const goalies = profiles
    .filter((p) => p.isGoalie)
    .filter((p) => options.force || !cache.goalies[p.id])
    .slice(0, options.limit ?? Infinity);

  console.log(
    `AI projecting ${skaters.length} skaters + ${goalies.length} goalies with ${DEFAULT_MODEL}...`,
  );

  for (const batch of chunk(skaters, BATCH_SIZE)) {
    const raw = await callOpenAi(buildSkaterPrompt(batch));
    const parsed = JSON.parse(raw) as { players: AiSkaterProjection[] };
    for (const p of parsed.players ?? []) {
      cache.skaters[p.id] = p;
    }
    console.log(`  skaters cached: ${Object.keys(cache.skaters).length}`);
    saveAiCache(cache);
    await new Promise((r) => setTimeout(r, 500));
  }

  for (const batch of chunk(goalies, BATCH_SIZE)) {
    const raw = await callOpenAi(buildGoaliePrompt(batch));
    const parsed = JSON.parse(raw) as { players: AiGoalieProjection[] };
    for (const p of parsed.players ?? []) {
      cache.goalies[p.id] = p;
    }
    console.log(`  goalies cached: ${Object.keys(cache.goalies).length}`);
    saveAiCache(cache);
    await new Promise((r) => setTimeout(r, 500));
  }

  cache.generatedAt = new Date().toISOString();
  saveAiCache(cache);
  return cache;
}

# Fantasy Hockey VOR

**Live site:** https://samuellachance.github.io/fantasy-hockey-vor/

**Repository:** https://github.com/SamuelLachance/fantasy-hockey-vor

AI-powered **Value Over Replacement** rankings for your head-to-head categories fantasy hockey league.

## Projection Engine

This is **not** a simple 3-year average. The pipeline:

1. **Collect** — Builds a full dossier per NHL player:
   - Bio (age, height, weight, handedness, birth place)
   - NHL Entry Draft (year, round, overall pick)
   - Team context (standings rank, GF/G, recent L10 form)
   - Team history & offseason changes
   - Injury/durability profile (games missed, trends)
   - Contract career stage (rookie / prime / veteran / decline)
   - 3 seasons of standard + advanced stats (SAT, zone starts, hits, blocks, faceoffs)
   - Career totals, awards, last 5 games

2. **AI Project** — OpenAI reads each dossier and predicts **2026-27** category totals for your league (requires API key).

3. **VOR Rank** — Category z-scores vs. replacement level in a 12-team league.

Players without AI cache use a **contextual fallback** that still uses the full dossier (team offense, age, draft pedigree, durability, usage trends).

## Quick Start

```bash
npm install
cp .env.example .env.local   # add OPENAI_API_KEY

npm run collect      # ~15 min — fetch all player dossiers
npm run ai-project   # ~2-4 hrs for all players (batched, resumable)
npm run generate     # build rankings from dossiers + AI cache
npm run dev
```

### Faster testing

```bash
# Collect + project a small batch first
PROFILE_LIMIT=30 npm run collect
AI_LIMIT=30 npm run ai-project
npm run generate
```

## Your League Settings

- **Roster:** 2C · 2LW · 2RW · 4D · 2G
- **Skater cats:** G, A, SOG, BLK, HIT, PPP, PIM, FOW
- **Goalie cats:** W, SO, SV, SV%

## Deploy

Auto-deploys to GitHub Pages on push to `master`.

## Data Sources

- [NHL API](https://api.nhle.com) — stats, rosters, player bios
- OpenAI — stat projections from full player context

Not affiliated with the NHL.

## License

MIT

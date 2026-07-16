# Fantasy Hockey VOR

**Live site:** https://samuellachance.github.io/fantasy-hockey-vor/

**Repository:** https://github.com/SamuelLachance/fantasy-hockey-vor

**Value Over Replacement** rankings for a head-to-head categories fantasy hockey league, powered by a stacked machine-learning projection system trained on 20 seasons of NHL data.

## Projection Engine (v2 stacked ensemble)

Every player with NHL history is projected by a walk-forward-validated stacked ensemble:

1. **Data** — NHL API player/team stats back to 2005-06, per-player game logs (injury spells, ironman streaks, roster timing), MoneyPuck xG/GSAx, entry-draft registry, contracts, team Elo/standings context.

2. **Base signals per stat** — gradient-boosted trees (histogram GBDT), ridge regression on a shared feature matrix, Marcel (age-adjusted weighted career rates), EWMA, last-season persistence, a contextual heuristic, and a shots×shooting% component model for goals. All persistence signals are era-normalized so league-wide scoring drift doesn't bias projections.

3. **Meta-learner** — non-negative least squares blends the base signals per stat, fit only on out-of-sample walk-forward predictions (no leakage), segmented by veteran/young and forward/defense. Goalie save% uses a convex meta (weights sum to 1) over GSAx-structural, Marcel and EWMA signals so elite goalies stay separated from the league mean.

4. **Synthetic-market / edge training** — GBDT and ridge train on residuals vs a walk-forward “market” (Marcel 50% + EWMA 30% + lag-1 20%). Meta sample weights upweight disagreement zones and Kelly-inspired draft-capital overlays. Optional adversarial feature noise hardens usage/context columns. The **Value** column is `consensusRank − modelRank` (positive = undervalued vs that synthetic consensus). No external ADP feed yet — upgrade path is swapping the market blend for real ADP when available. Disable with `ML_MARKET_TRAINING=0` / `ML_ADVERSARIAL=0`.

5. **Games played** — dedicated GBDT + ridge + a game-log durability signal (injury spells vs. healthy scratches vs. call-up timing, ending ironman streaks, late-season rest on contenders, physical wear from TOI × hits/blocks, goalie back-to-back workload).

6. **VOR rank** — per-category z-scores weighted by scarcity, compared to replacement level at each position in a 12-team league. Position eligibility comes from Yahoo Fantasy.

Players without NHL history fall back to a contextual dossier model (prospect stats, draft pedigree, team depth). An optional OpenAI dossier engine exists (`npm run ai-project`) but is not used for the published rankings.

## Quick Start

Projections, trained models, and all data artifacts are committed — the site builds without any API calls:

```bash
npm install
npm run dev          # local dev server with committed rankings
```

## Refreshing Data & Retraining

```bash
npm run collect              # fetch all player dossiers (~15 min)
npm run yahoo:fetch          # optional: Yahoo position eligibility (needs OAuth)

npm run ml:dataset           # build player-season training dataset (long)
npm run ml:gamelogs          # fetch game logs, derive durability features
npm run ml:context           # age/draft/team context caches
npm run moneypuck:skaters    # MoneyPuck skater xG registry
npm run moneypuck:goalies    # MoneyPuck goalie GSAx registry
npm run ml:enrich-moneypuck  # merge MoneyPuck data into the dataset

npm run ml:train-v2          # train the production stacked ensemble
npm run generate             # produce players.json rankings
```

Evaluation tooling: `npm run ml:backtest` runs a multi-season rolling-origin backtest against Marcel/EWMA/persistence baselines (includes agreement/disagreement market zones); `npm run ml:sanity-market` checks synthetic-market helpers; `scripts/benchmark-*.ts` cover segment-level holdout metrics.

## League Settings

- **Roster:** 2C · 2LW · 2RW · 4D · 2G
- **Skater cats:** G, A, SOG, BLK, HIT, PPP, PIM, FOW
- **Goalie cats:** W, SO, SV, SV%

## Deploy

Auto-deploys to GitHub Pages on push to `master` (lint → typecheck → data validation → static export).

## Data Sources

- [NHL API](https://api.nhle.com) — stats, rosters, game logs, player bios
- [MoneyPuck](https://moneypuck.com) — expected goals, goals saved above expected
- Yahoo Fantasy — position eligibility

Not affiliated with the NHL.

## License

MIT

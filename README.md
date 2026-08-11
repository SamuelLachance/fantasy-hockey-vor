# Fantasy Hockey VOR

**Live site:** https://samuellachance.github.io/fantasy-hockey-vor/

**Repository:** https://github.com/SamuelLachance/fantasy-hockey-vor

**Value Over Replacement** rankings for a head-to-head categories fantasy hockey league, powered by a stacked machine-learning projection system trained on NHL history (back to 2005-06 where feeds allow).

## Projection Engine (v2 stacked ensemble)

Every player with NHL history is projected by a walk-forward-validated stacked ensemble:

1. **Data** — NHL API player/team stats, per-player game logs (injury spells, ironman streaks, roster timing), MoneyPuck xG/GSAx, entry-draft registry, contracts, team Elo/standings context. Franchise moves (ARI→UTA, ATL→WPG) are remapped for team-season lookups.

2. **Base signals per stat** — gradient-boosted trees (histogram GBDT), ridge regression on a shared feature matrix, Marcel (age-adjusted weighted career rates), EWMA, last-season persistence, a contextual heuristic, and a shots×shooting% component model for goals. Persistence signals are era-normalized.

3. **Meta-learner** — non-negative least squares blends the base signals per stat, fit only on out-of-sample walk-forward predictions (no leakage), segmented by veteran/young and forward/defense. Goalie save% uses a convex meta over structural / Marcel / EWMA signals.

4. **Synthetic-market / edge training** — GBDT and ridge train on residuals vs a walk-forward “market” (Marcel 50% + EWMA 30% + lag-1 20%). The **Edge** column is `consensusRank − modelRank` (positive = undervalued vs that synthetic consensus). Disable with `ML_MARKET_TRAINING=0` / `ML_ADVERSARIAL=0`.

5. **Games played** — dedicated GBDT + ridge + game-log durability (injury spells vs healthy scratches, ironman, B2B goalie workload).

6. **GP calibration** — the GP heads regress toward the population mean, so projected games are mapped onto realized prior-season games by a weighted isotonic (PAVA) fit over the same players. Monotone by construction: the model's durability *ordering* is preserved, only the level is corrected. Counting stats scale with GP so per-game rates are untouched. Raw model GP is kept in `modelGamesPlayed`, making the step idempotent.

7. **VOR rank** — per-category z-scores against the draftable pool, **centered on the player's own position group** with a pooled within-position spread (every team fields the same roster quotas, so the position mix cancels in weekly matchups; a mixed-pool spread otherwise inflates position-skewed stats like blocks). Weights are near-equal — in H2H each category is one matchup point, and a scarcity-proportional weight would double-count the z-gap it is derived from — with a small tilt for per-category model predictability. Replacement level in a 12-team league. Goalie SV% is volume-weighted saves above average; total goalie value is discounted (`goalieVorFactor`). Position eligibility comes from Yahoo Fantasy when configured.

Players without NHL history fall back to a contextual dossier model. Optional OpenAI dossiers (`npm run ai-project`) are not used for published rankings.

## Quick Start (browse committed rankings)

Committed artifacts (`players.json`, `v2-bundle.json`, context caches) let you run the site without calling the NHL API:

```bash
npm install
npm run dev
```

**Note:** `src/data/ml/dataset.json` is **gitignored** (large). Retraining or `npm run generate` on a fresh clone requires rebuilding the dataset locally first (see below). CI builds the static site from committed `players.json` and does not re-run generate.

## Refreshing Data & Retraining

Order matters — durability and MoneyPuck enrichment expect an existing dataset:

```bash
npm run collect              # player dossiers (~15 min)
npm run yahoo:fetch          # optional: Yahoo eligibility (OAuth)

npm run ml:dataset           # player-season training rows (long; writes gitignored dataset.json)
npm run ml:gamelogs          # game logs → durability features
npm run ml:context           # age/draft/team context cache
npm run draft:registry       # entry draft registry
npm run refresh:draft        # refresh draft-linked fields
npm run moneypuck:skaters
npm run moneypuck:goalies
npm run ml:enrich-moneypuck  # merge MoneyPuck into dataset
npm run ml:re-enrich         # re-apply context enrichment if caches changed

npm run ml:train-v2          # production stacked ensemble → v2-bundle.json
npm run generate             # players.json + public/player-details.json
```

Legacy ridge/GBM (`npm run ml:train` / `ml:train:legacy`) is fallback-only and skipped when a v2 runtime is present; production is **`ml:train-v2`**.

Checks: `npm run check:data`, `npm run check:teams` (franchise abbrev continuity), `npm run typecheck`, `npm run lint`.

Full local gate (mirrors Pages CI): `npm run ci:local`.

Yahoo eligibility gaps (mostly farm/retired): `npm run yahoo:gaps`.

Curated inactive denylist (`src/data/inactive-player-ids.json`): applied at generate *before* tandem GP renormalization, so an inactive goalie never absorbs part of a team's starts budget; purge committed board with `npm run players:drop-inactive`.

Re-apply GP calibration + VOR + Edge on the committed board without a regenerate: `npm run gp:recalibrate` (idempotent — recalibrates from `modelGamesPlayed`).

Evaluation: `npm run ml:backtest`, `npm run ml:sanity-market`; `scripts/benchmark-*.ts` for segment holdouts.

## League Settings

- **Roster:** 2C · 2LW · 2RW · 4D · 2G (12 teams)
- **Skater cats:** G, A, SOG, BLK, HIT, PPP, PIM, FOW (FOW = 0 for D)
- **Goalie cats:** W, SO, SV, SV%

## Board UX

- URL sync: `pos`, `q`, `sort`, `dir`, `player`, `g=all` (depth goalies), `rf` (stat ranges e.g. `sigma:-50`)
- Columns: VOR, Edge (consensus−model), Σσ (calibrated uncertainty), GP, cats
- Shortcuts: `/` search · `f` filters · `r` reset · `l` copy link · `Home`/`End` (End focuses search) · `v`/`e`/`u`/`g` sort · `?` help · `j`/`k` · `Esc`
- Active board filters (position, search, stats) show as removable chips when the filter panel is closed
- Export filtered CSV/JSON or copy a shareable board / player link

## Deploy

Auto-deploys to GitHub Pages on push to `master` (lint → typecheck → data validation → static export). Deploy retries on transient Pages failures.

## Data Sources

- [NHL API](https://api.nhle.com) — stats, rosters, game logs, player bios
- [MoneyPuck](https://moneypuck.com) — expected goals, goals saved above expected
- Yahoo Fantasy — position eligibility

Not affiliated with the NHL.

## Known limitations

- `teamPkGaPer60` / PK style feature is a shorthanded-goals-scored proxy (not on-ice PK GA/60). Training and inference match today; correcting it requires a paired dataset rebuild + `ml:train-v2`.
- Inactive/retired names are excluded via `src/data/inactive-player-ids.json` (extend as needed).
- `ewma()` in `src/lib/ml/features.ts` infers its season count with a value filter + `indexOf`, which mis-weights zero/duplicate lags, and the `age >= 36` branch of `age_curve_mult` is unreachable. Both are *training-time* features: the committed bundle was fit with them, so training and inference match today and correcting them requires a paired dataset rebuild + `ml:train-v2` (same reasoning as `teamPkGaPer60`). `normalizeTandemGp`'s `sum >= 150` skip is in the same category.
- The goalie saves decode fix in `predict-v2.ts` (shots recovered at the goalie's own SV% rather than the league's) lands on the next `npm run generate`; the committed board still carries the ~2% skew for high-SV% goalies, which cannot be inverted post-hoc.

## License

MIT

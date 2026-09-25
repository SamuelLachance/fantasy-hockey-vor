# Fantasy Hockey VOR

**Live site:** https://samuellachance.github.io/fantasy-hockey-vor/

**Repository:** https://github.com/SamuelLachance/fantasy-hockey-vor

A personal, unofficial helper for my fantasy hockey leagues, in French (Québec): one space per league, with tabs, fed by a stacked machine-learning NHL projection system trained on NHL history (back to 2005-06 where feeds allow). Static export on GitHub Pages; every page is `noindex`.

## Site structure

| URL | Page |
|---|---|
| `/` | **Mes ligues**: one card per league (what needs attention today, draft dates, links to each tab) and the Snake database |
| `/ligues/captains-dynasty/<onglet>` | Captains Dynasty League (Fantrax · dynastie · points): `aujourdhui`, `repechage`, `joueurs`, `ballottage`, `mon-equipe` |
| `/ligues/light-the-lamp/<onglet>` | Light the Lamp (Yahoo · saison unique · catégories): `repechage`, `joueurs`, `mon-equipe`, `duel` |
| `/snake` (`?p=<clé>`) | Les opinions de Snake (unofficial database of Simon « Snake » Boisvert's podcast opinions) |
| `/league` | Old Captains address: a static stub that forwards query and hash (`?team=`, `?vue=`, `#alignement`…) to the right tab |
| `/draft/light-the-lamp` | Old draft-helper address, kept as a real page (same helper, same browser storage) until after the draft |

The old English VOR rankings board that used to live at `/` is gone (it valued players for an old Yahoo categories setup that matches neither league): each league's **Joueurs** tab values the players for that league's own settings. An old board link (`/?player=…#rankings`) lands on « Mes ligues » with a notice that points to those tabs.

Everything is driven by the league registry, `src/lib/leagues/registry.ts`: the global navigation, the home cards, the static routes (`app/ligues/[ligue]/[onglet]`, `dynamicParams = false`), the old-URL redirects and the export checks. The league layout holds each league's shared state (the Fantrax team, snapshot and live overlay persist from one tab to the next); `src/components/league-shell/server-adapters.tsx` maps each kind of league to its providers, header block and tab bodies (one client chunk per kind and tab). The Captains tabs read the league through `src/components/fantrax/fantrax-league-context.ts`, never the provider's module, and load the pool through `src/lib/fantrax/pool-client.ts`: each tab's chunk then carries its own code only, not a second copy of the planner and the live Fantrax reads (`scripts/check-ui-contracts.ts` guards the imports, `scripts/check-export.ts` the size of each page).

**One player table** (`src/components/player-table/PlayerTable.tsx`, model in `src/lib/player-table/`): every league's player lists are the same component, with its presets (chips), search (accents, case and name punctuation folded: « jt miller », « oreilly »), columns to choose, sorts, pages, a details row (facts plus Snake's synthesis and latest opinions, loaded when the row opens) and a view kept in the address as its difference from the tab's base view (so a clean tab URL shows the tab's default, and `?vue=<preset>` / `?joueur=<id>` open a view or a player). Each kind of league brings an adapter: its rows, columns, filters (parse / serialize / test are its own) and cells. Captains Dynasty's (`src/lib/fantrax/table.ts`, `src/components/fantrax/fantrax-table.tsx`) powers Repêchage (best available, shown from the current plan until `pool.json` is in), Joueurs, Ballottage and Mon équipe; the categories leagues' (`src/lib/draft/table.ts`, `src/components/draft/category-table.tsx`) powers Light the Lamp's Joueurs and Mon équipe. Snake's verdicts load with the page (`src/lib/snake/verdicts.ts`; the full index only for the « Opinions » column); dynasty columns and the « Conseil » hint appear only when the build finds `public/fantrax/dynasty.json` (no pipeline publishes it yet).

**Adding a league**: add a `LEAGUES` entry (slug, kind, tabs, default tab, platform facts). For a Yahoo categories league, add its profile `src/data/leagues/<profileSlug>.json`; `npm run draft:board` and `check:draft-board` build every categories league of the registry. A new kind of league also needs its `KIND_TABS`, a server adapter, client tab components and a player-table adapter.

**Old URLs** (GitHub Pages has no server redirects): `src/lib/leagues/legacy.ts` says where each old address goes; the stubs and `404.html` embed the same rule as an inline ES5 script (plus a `<noscript>` refresh and a visible link), which also recovers trailing slashes (`/league/`, `/snake/`) and league roots (`/ligues/captains-dynasty`).

## Projection Engine (v2 stacked ensemble)

Every player with NHL history is projected by a walk-forward-validated stacked ensemble:

1. **Data** — NHL API player/team stats, per-player game logs (injury spells, ironman streaks, roster timing), MoneyPuck xG/GSAx, entry-draft registry, contracts, team Elo/standings context. Franchise moves (ARI→UTA, ATL→WPG) are remapped for team-season lookups.

2. **Base signals per stat** — gradient-boosted trees (histogram GBDT), ridge regression on a shared feature matrix, Marcel (age-adjusted weighted career rates), EWMA, last-season persistence, a contextual heuristic, and a shots×shooting% component model for goals. Persistence signals are era-normalized.

3. **Meta-learner** — non-negative least squares blends the base signals per stat, fit only on out-of-sample walk-forward predictions (no leakage), segmented by veteran/young and forward/defense. Goalie save% uses a convex meta over structural / Marcel / EWMA signals.

4. **Synthetic-market / edge training** — GBDT and ridge train on residuals vs a walk-forward “market” (Marcel 50% + EWMA 30% + lag-1 20%). **Edge** (`draftValue` in `players.json`) is `consensusRank − modelRank` (positive = undervalued vs that synthetic consensus). Disable with `ML_MARKET_TRAINING=0` / `ML_ADVERSARIAL=0`.

5. **Games played** — dedicated GBDT + ridge + game-log durability (injury spells vs healthy scratches, ironman, B2B goalie workload).

6. **GP calibration** — the GP heads regress toward the population mean, so projected games are mapped onto realized prior-season games by a weighted isotonic (PAVA) fit over the same players. Monotone by construction: the model's durability *ordering* is preserved, only the level is corrected. Counting stats scale with GP so per-game rates are untouched. Raw model GP is kept in `modelGamesPlayed`, making the step idempotent.

7. **VOR rank** — per-category z-scores against the draftable pool, **centered on the player's own position group** with a pooled within-position spread (every team fields the same roster quotas, so the position mix cancels in weekly matchups; a mixed-pool spread otherwise inflates position-skewed stats like blocks). Weights are near-equal — in H2H each category is one matchup point, and a scarcity-proportional weight would double-count the z-gap it is derived from — with a small tilt for per-category model predictability. Replacement level in a 12-team league. Goalie SV% is volume-weighted saves above average; total goalie value is discounted (`goalieVorFactor`). Position eligibility comes from Yahoo Fantasy when configured.

Players without NHL history fall back to a contextual dossier model. Optional OpenAI dossiers (`npm run ai-project`) are not used for published rankings.

The VOR stored in `players.json` follows an old categories setup and is no longer shown: each league values the projections for its own settings (Light the Lamp: `category-vor.ts`; Captains Dynasty: Fantrax points).

## Quick Start

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

## Leagues

### Captains Dynasty (Fantrax, points)

`npm run league:sync` bakes the league (`src/data/fantrax/*`, `public/fantrax/*`, read-only fxea/fxpa GETs); the daily Action (`league-daily.yml`) re-runs it twice a day and redeploys. In the browser the tabs re-run the same pure planner for any team at the current time, with live rosters and draft picks from Fantrax (polled every 90 s while the draft runs).

### Light the Lamp and other Yahoo categories leagues

League profiles in `src/data/leagues/<slug>.json` feed a parameterised category engine (`src/lib/leagues/category-vor.ts`): only the profile's categories, GAA as goals prevented, smoothed shutouts, an optimal flex-aware seat fill (F/Util, multi-eligibility) with flex-chain replacement levels, and a goalie weight = weekly matchup leverage (derived) × a predictability discount (modelling choice; the softer alternative is shown on the page).

- `npm run draft:board [-- <slug>]` → `public/leagues/<slug>/board.json` (deterministic, committed; without a slug, every categories league of the registry). `build:pages` regenerates it before `next build`, so deploys always match `players.json`; `npm run check:draft-board` (part of `check`) sanity-checks the fresh build and only warns when the committed file lags.
- **Repêchage** tab — live snake-draft helper: VOR board, "Repêché"/"Mon choix" marks (Entrée = my pick when on the clock), undo of any action, snake picks from "Ma position", ADP-based availability, lineup + category strength, suggestions (lineup gain + VONA + category balance), localStorage (`vor-draft:<slug>:v1`) + text export/import, and Snake's verdict chip on each row (from a build-time seed that covers the whole board: nothing is fetched during the draft).
- **Joueurs** tab — the unified player table with the categories adapter (`src/lib/draft/table.ts`, `src/components/draft/category-table.tsx`): the board's players with rank (by position under a position filter), VOR, value, category bars, one column per league category (projected stat, colored and sorted by z), ADP, odds at my next pick, the draft marks of this device, age, Snake. Chips « Tous », « Disponibles » (« Non repêchés » once the draft is over), « Mes choix ». Same rank, position filter, search and odds as the draft board (tested).
- **Mon équipe** tab — the players marked « Mon choix » (same browser storage): lineup, bench and category strengths, then the same players in the table; after the draft, « Effectif au repêchage » (device-local: trades and waivers need the Yahoo API). **Duel de la semaine** explains what that API would take.

## Deploy

Auto-deploys to GitHub Pages on push to `master` (lint → typecheck → data validation → unit tests → league sync → static export → export checks). `scripts/check-export.ts` (run by `build:pages`) checks the built pages: French `lang`, noindex, one `<main>` / `<h1>`, basePath links without trailing slashes, the old-URL stubs and the 404 recovery, no English left, complete HTML without JavaScript, and a JavaScript / HTML size budget (budget overruns only warn on the deploy workflows). To try the export like GitHub Pages: `GITHUB_PAGES=true npm run build:pages && GITHUB_PAGES=true npm run serve:pages`.

## Data Sources

- [NHL API](https://api.nhle.com) — stats, rosters, game logs, player bios
- [MoneyPuck](https://moneypuck.com) — expected goals, goals saved above expected
- Yahoo Fantasy — position eligibility

Not affiliated with the NHL.

## Known limitations

- `teamPkGaPer60` / PK style feature is a shorthanded-goals-scored proxy (not on-ice PK GA/60). Training and inference match today; correcting it requires a paired dataset rebuild + `ml:train-v2`.
- Inactive/retired names are excluded via `src/data/inactive-player-ids.json` (extend as needed).
- The goalie saves decode fix in `predict-v2.ts` (shots recovered at the goalie's own SV% rather than the league's) lands on the next `npm run generate`; the committed board still carries the ~2% skew for high-SV% goalies, which cannot be inverted post-hoc.
- `features.ts` (`ewma` season counting, `age_curve_mult` ordering) feeds the **legacy v1** path only — `age_curve_mult` does not appear in `v2-bundle.json`, and the v2 stack has its own EWMA in `dataset-view.ts` / `marcel.ts`. Those bugs are fixed; the mismatch is now with the legacy `models.json`, which is fallback-only and refused by `generate` unless `ALLOW_NON_V2=1`. Regenerate it with `ml:train` if you ever intend to use that path.
- `normalizeTandemGp` is training-only (inference goes through `inferGoalieForPlayer`), so its fix takes effect at the next `ml:train-v2` and does not move the committed board.

## License

MIT

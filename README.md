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

**One player table** (`src/components/player-table/PlayerTable.tsx`, model in `src/lib/player-table/`): every league's player lists are the same component, with its presets (chips), search (accents, case and name punctuation folded: « jt miller », « oreilly »), columns to choose, sorts, pages, a details row (facts plus Snake's synthesis and latest opinions, loaded when the row opens) and a view kept in the address as its difference from the tab's base view (so a clean tab URL shows the tab's default, and `?vue=<preset>` / `?joueur=<id>` open a view or a player). Each kind of league brings an adapter: its rows, columns, filters (parse / serialize / test are its own) and cells. Captains Dynasty's (`src/lib/fantrax/table.ts`, `src/components/fantrax/fantrax-table.tsx`) powers Repêchage (best available, shown from the current plan until `pool.json` is in), Joueurs, Ballottage and Mon équipe; the categories leagues' (`src/lib/draft/table.ts`, `src/components/draft/category-table.tsx`) powers Light the Lamp's Joueurs and Mon équipe. Snake's verdicts load with the page (`src/lib/snake/verdicts.ts`; the full index only for the « Opinions » column); Captains' dynasty columns, filters and hints come from `public/fantrax/dynasty.json` (rebuilt by every league sync) and only appear when the build finds it.

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

   **Split seasons** (`src/lib/split-season.ts`, `src/lib/split-season-gp.ts`): the NHL feeds only count NHL games, so a late signing's 14 games after a college season (Cole Hutson, 2025-26: 35 games at Boston University) read like 68 games lost to injury; the curve, fitted on realized prior-season GP where call-ups sit low by construction, then took him from a model 45 to 32. Games in another club league (AHL, NCAA, CHL, Europe; international events left out) come from the NHL landing `seasonTotals` (`src/data/league-seasons.json`, `npm run collect:leagues`: every player of the 2005-26 game logs and of the profiles, one public request per 1.1 s). A season with 6+ of them is a **split season**: the injury profile leaves it out (no games "missed", durability from NHL-only seasons), and the published GP comes from a rule fitted on history instead of the curve. Same for an **away season** (no NHL game last season, 6+ club games elsewhere, NHL games one or two seasons before). The rule is a ridge regression of next-season NHL games on the 2008-25 split / away skater seasons (NHL share, TOI, finishing the season with the NHL club from the game logs, age, draft, league, career games, MoneyPuck game score per game; a first NHL stint after college / junior / Europe gets its own terms, whether he finished the season with the club or went back, like Brady Martin after 3 games), refit with `npm run gp:split-fit` (`src/data/ml/split-season-gp.json`, walk-forward backtest against the pipeline inside; `-- --dry` reports without writing). It applies in `generate` and `gp:recalibrate` after the curve; everyone else keeps the curve's GP, and the rate calibration still pools players on the curve's GP (`availability.curveGamesPlayed`), so the rule never moves another player's rates. A contextual player under the rule (no 10-game NHL season) is re-projected at the rule's games; his hits, blocks and faceoffs pool all his NHL games with a position prior (they used to read 0). The fit also stores the rule's error as a probit scale (`roleSd`, ≈ 22 games: P(40+ games) = Φ((GP − 40) / 22); realized shares 0.13 / 0.43 / 0.62 / 0.81 for predictions of 10-20 / 30-40 / 40-50 / 50-60 games, the scale says 0.13 / 0.40 / 0.59 / 0.75), published as `availability.gpSd`: the Captains dynasty blends its NHL and prospect routes by it. If `league-seasons.json` lacks the last completed season (< 50% of the players active the season before), the rule is switched off with a warning rather than silently finding no split season. Goalies keep the tandem allocation.

7. **Rate calibration** (`src/lib/rate-calibration.ts`) — every v2 skater rate is synthetic market + residual edge; the market carries the level, the edge says who beats it. It exists because the 2026-07-30 regeneration (same bundle as the healthy 2026-07-21 board, a `dataset.json` that no longer matched training) added an almost constant edge to every skater: +9.6 goals / +10 assists / +46 shots per 82 games for veteran forwards (13,159 projected skater goals for a ~8,000-goal season), and a different amount per meta-learner segment (young forwards +5 goals, young D +66 shots). The calibration therefore works per v2 meta segment (young = at most 2 eligible NHL seasons, or veteran, × F / D; a segment under 25 regulars falls back to its F / D group): per stat it fits the raw edge of the 40+ GP regulars against the market (a mean; a line for PPP, shots and blocks, whose drift also tilted) and moves it onto the same fit of a healthy board of the same bundle (`src/data/ml/rate-reference.json`, from commit 5291e33 by `npm run rates:reference`). Keeping the reference's edge keeps the model's real growth and decline terms (young forwards beat a no-growth market; the market over-projects veteran D hits by ~13 per 82). Without a reference for the running bundle the target is a zero edge (and `check:data` warns). Totals are recomputed from the raw rates at the calibrated GP. The raw model rates (`modelRates`, uncapped), edges (`modelMarketEdge`) and segment (`modelSegment`) live in `public/player-details.json`, so the step is idempotent. `generate` applies it and warns when a removed shift exceeds 15% of a stat's level; `check:data` fails when goals or shots per skater-game leave a realistic band, or when a segment's projection leaves its band around its no-growth market (`SEGMENT_LEVEL_BOUNDS`). The per-game rate limits (`projection-sanity.ts`) only catch broken output now: the old D goals limit (0.18 per game) had capped Makar, Werenski, Bouchard, Dahlin… at 12-14 goals. In the same spirit, power-play points never pass 60% of goals + assists, the highest share of any 40-game, 20-point season in the profiles (a 14-game sample carried at full rate had Cole Hutson at 17 PPP for 24 points).

8. **VOR rank** — per-category z-scores against the draftable pool, **centered on the player's own position group** with a pooled within-position spread (every team fields the same roster quotas, so the position mix cancels in weekly matchups; a mixed-pool spread otherwise inflates position-skewed stats like blocks). Weights are near-equal — in H2H each category is one matchup point, and a scarcity-proportional weight would double-count the z-gap it is derived from — with a small tilt for per-category model predictability. Replacement level in a 12-team league. Goalie SV% is volume-weighted saves above average; total goalie value is discounted (`goalieVorFactor`). Position eligibility comes from Yahoo Fantasy when configured.

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
npm run collect:leagues      # games in other leagues per season (resumable, ~70 min cold; each new season refetches the players read before it) + profiles re-read
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

Re-apply GP calibration + VOR + Edge on the committed board without a regenerate: `npm run gp:recalibrate` (idempotent — recalibrates from `modelGamesPlayed`, applies the split-season rule, then re-applies the rate calibration). After a new season of game logs (`ml:gamelogs`) or `collect:leagues`, refit the rule with `npm run gp:split-fit`. `npm run league:revalue` then re-values the committed Fantrax snapshot (values, pool, today's plan) from the new players.json without a network sync and rebuilds the dynasty values; on an unchanged players.json it rewrites the snapshot byte for byte.

Re-apply the rate calibration + VOR + Edge: `npm run rates:recalibrate` (idempotent — recalibrates from `modelRates` / `modelMarketEdge` / `modelSegment`). On a board published before those fields existed it bootstraps them once: the segment from the v2 reasoning, the market from a rebuild from the committed profiles (`src/lib/ml/market-rebuild.ts`), which reproduces the healthy 2026-07-21 board's market to ~0.005 per game when the rebuild is reliable (the player's whole history is in the profiles, or 100+ profile games). With a reliable rebuild every cell moves onto the rebuilt market and keeps its edge (the 2026-07-30 dataset had wrong hits / blocks / PPP / PIM histories: Mark Stone hits, Kadri and Panarin blocks…), a grossly corrupted cell gets the rebuilt market with no edge (Weegar, Q. Hughes, Carlson blocks…), and a cell the old rate caps clipped gets market + edge. The counts are recorded in `players.json` `rateCalibration.bootstrap`. Refit the reference with `npm run rates:reference [-- --rev <commit>]` after a retrain, from the first healthy board of the new bundle. Then `npm run draft:board` and `npm run league:sync` (Fantrax values + dynasty). The dynasty's projected → realized map (`params.json` `scale`) is fitted on the published projections: refit it whenever their level changes.

Evaluation: `npm run ml:backtest`, `npm run ml:sanity-market`; `scripts/benchmark-*.ts` for segment holdouts.

## Leagues

### Captains Dynasty (Fantrax, points)

`npm run league:sync` bakes the league (`src/data/fantrax/*`, `public/fantrax/*`, read-only fxea/fxpa GETs), then rebuilds the dynasty values `public/fantrax/dynasty.json` (`src/lib/dynasty/`, about 30 s; `-- --no-dynasty` skips it); the daily Action (`league-daily.yml`) re-runs it twice a day and redeploys, and `npm run check:league` gates both the snapshot and the dynasty values. In the browser the tabs re-run the same pure planner for any team at the current time, with live rosters and draft picks from Fantrax (polled every 90 s while the draft runs).

Routing: a player with an NHL role (40+ projected games, or 100+ career games) goes through the NHL path, a prospect record through the prospect path. When a prospect's projected games come from the split-season rule (a late signing or a call-up), the two routes are simulated and their paths mixed by P(40+ games) under the rule's error (`nhlShare` in `dynasty.json`, quoted in the French sentence): a hard cut on that estimate moved values 4-6× on a game or two (Konsta Helenius at 40.5 games: 123 on the NHL route, 30 on the prospect route).

Dynasty values in the tabs (one table, one mode for every tab: « Gagner maintenant · Équilibré · Long terme », `?mode=`, Équilibré by default, carried by the tab links; a change of mode is said in the table's live region). The browser fetches `public/fantrax/dynasty-table.json`, a lighter copy of `dynasty.json` without the report-only fields (about 110 KB gzipped instead of 154), written by every dynasty build and by `npm run build:pages` (`scripts/dynasty-client.ts`, not committed); a dev server before any build falls back to `dynasty.json`. One vocabulary for the 2027 cutdown everywhere (cell, filter, card, home line): Protéger · À décider · Location · Gratuit.

- **Joueurs / Repêchage / Ballottage**: columns « Valeur dyn. » (the mode's value and league rank), « Phase » (espoir, en progression, entre dans son prime, dans son prime, plateau, en déclin, fin de carrière; « déjà établi » for a young player whose level should hold, « léger déclin » before 31: the model's phase comes from the adjusted age and expected progression, not the age alone), « Tendance %/an », « Chances LNH », « Arrivée », « Écrémage 2027 » (his team's 10 keeper slots while he is on the roster the model saw, else the league's 160, marked « ligue »; « Gratuit » with « à protéger dès 2028 » while minors-eligible), « Fourchette » (8 chances in 10 the value ends in it) and « Conseil »; a visible legend under the mode switch. « Conseil » reads from the chosen team's side: its own players get the owner's hint, available players what they would be for whoever takes them (« Cible à protéger », « Pour cette saison » only with a win-now value, « Faible valeur »), other teams' players where their team stands. Filters on phase, value (in the mode), cutdown outlook, « Gratuit aux écrémages » (2027, 2027 et 2028, 2027 à 2029) and NHL odds (a lazily loaded row); a sort on each. « — » in « Valeur dyn. » means the model never saw the player; 0, below the published list. The chip « Meilleure valeur dynastie disponible » lists players and prospects nobody has by dynasty value; « Espoirs ≤ 21 ans » sorts by it. On Repêchage the season columns (« Valeur saison », VONA, odds) stay first with the dynasty value beside them: two units, never added. The details row (loaded when a row opens) carries the model's French sentence, the expected gain of the next six seasons with each value printed, and the « Conseil » sentence.
- **Mon équipe**: the 2027 cutdown against the team's 10 slots in one line (« 5 à protéger, 6 à décider, 6 en location, 28 gratuits (mineures) »), who is on the line and which rentals to trade before then, computed on the roster of the sync; players drafted, claimed or traded in since are listed apart with the league's odds, out of the counts. The roster below is ranked by dynasty value with phase, outlook and hint (protéger, vendre si reconstruction, à décider, échanger avant 2027, garder gratuitement). The home card carries the same outlook in one line.

### Light the Lamp and other Yahoo categories leagues

League profiles in `src/data/leagues/<slug>.json` feed a parameterised category engine (`src/lib/leagues/category-vor.ts`): only the profile's categories, GAA as goals prevented, smoothed shutouts, an optimal flex-aware seat fill (F/Util, multi-eligibility) with flex-chain replacement levels, and a goalie weight = weekly matchup leverage (derived) × a predictability discount (modelling choice; the softer alternative is shown on the page).

- `npm run draft:board [-- <slug>]` → `public/leagues/<slug>/board.json` (deterministic, committed; without a slug, every categories league of the registry). `build:pages` regenerates it before `next build`, so deploys always match `players.json`; `npm run check:draft-board` (part of `check`) sanity-checks the fresh build and only warns when the committed file lags. The board is the engine's top 400, plus the goalie floor and every **market pick** past it (Fantrax ADP inside the league's teams × rounds, 216 picks) at its own engine rank, so a player the other managers will take is always there to be marked (Cole Hutson: ADP 113, engine rank past 400).
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

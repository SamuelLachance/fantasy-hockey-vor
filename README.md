# Fantasy Hockey VOR

**Live site:** https://samuellachance.github.io/fantasy-hockey-vor/

**Repository:** https://github.com/SamuelLachance/fantasy-hockey-vor

AI-weighted **Value Over Replacement** rankings for your head-to-head categories fantasy hockey league.

Built for leagues with daily lineups of **2C · 2LW · 2RW · 4D · 2G** and these categories:

| Skaters | Goalies |
|---------|---------|
| Goals, Assists, Shots, Blocks, Hits, PPP, PIM, Faceoff Wins | Wins, Shutouts, Saves, Save % |

## Features

- Projections for **every NHL player** (skaters + goalies)
- VOR rankings based on category z-scores vs. replacement level (12-team default)
- Position filters, search, sortable table
- Category breakdown per player (click any row)
- Dark ice-themed UI

## Quick Start

```bash
npm install
npm run generate   # Fetch NHL data & build projections
npm run dev        # Start at http://localhost:3000
```

## How Projections Work

The `generate` script pulls 3 seasons of NHL stats (summary, realtime, faceoffs) plus current team rosters, then projects the upcoming season using:

1. **Weighted rate stats** — 55% most recent season, 30% prior, 15% two seasons ago
2. **Age curves** — slight boosts for young players, declines for veterans
3. **Games played regression** — projected GP based on recent availability

Run weekly during the offseason and preseason to refresh:

```bash
npm run generate
```

## VOR Methodology

1. Each category stat is converted to a **z-score** across the full player pool
2. Z-scores are summed into a **fantasy value** score
3. **Replacement level** = fantasy value of the Nth-ranked player at each position (N = teams × roster spots)
4. **VOR** = player fantasy value − replacement level at their position

Default league: 12 teams → replacement at C/LW/RW #24, D #48, G #24.

## Deploy

The site auto-deploys to **GitHub Pages** on every push to `master`.

Live URL: https://samuellachance.github.io/fantasy-hockey-vor/

To deploy manually, push to GitHub — the Actions workflow builds and publishes the static site.

For other hosts (Vercel, Netlify):

```bash
npm run build
npm start
```

## Data Source

Stats from the public [NHL API](https://api.nhle.com). Not affiliated with the NHL.

## License

MIT

import assert from "node:assert/strict";
import {
  franchiseTeamForSeason,
  franchiseTeamSeasonKey,
  normalizeTeamAbbrev,
  primaryTeam,
} from "../src/lib/team-abbreviations";
import { teamSeasonKey } from "../src/lib/ml/context-types";

assert.equal(primaryTeam("DAL,COL"), "DAL");
assert.equal(normalizeTeamAbbrev("ARI"), "UTA");
assert.equal(normalizeTeamAbbrev("PHX"), "UTA");
assert.equal(normalizeTeamAbbrev("SJ"), "SJS");

// Utah relocation: 2023-24 context lives under ARI
assert.equal(franchiseTeamForSeason("UTA", 20232024), "ARI");
assert.equal(franchiseTeamForSeason("ARI", 20232024), "ARI");
assert.equal(franchiseTeamForSeason("UTA", 20242025), "UTA");
assert.equal(franchiseTeamSeasonKey("UTA", 20232024), "ARI:20232024");

// Winnipeg / Atlanta
assert.equal(franchiseTeamForSeason("WPG", 20102011), "ATL");
assert.equal(franchiseTeamForSeason("WPG", 20112012), "WPG");

// Context cache key must resolve UTA→ARI for 2023-24
assert.equal(teamSeasonKey(20232024, "UTA"), "20232024|ARI");
assert.equal(teamSeasonKey(20232024, "ARI"), "20232024|ARI");
assert.equal(teamSeasonKey(20242025, "UTA"), "20242025|UTA");

// Franchise continuity must not look like a free-agent move
import { teamChangedFlag, yearsOnCurrentTeam } from "../src/lib/ml/team-style";
import type { PlayerSeasonRow } from "../src/lib/ml/types";

const coyotesHistory = [
  { team: "ARI", seasonId: 20222023, gamesPlayed: 70 },
  { team: "ARI", seasonId: 20232024, gamesPlayed: 70 },
  { team: "UTA", seasonId: 20242025, gamesPlayed: 70 },
] as PlayerSeasonRow[];
assert.equal(teamChangedFlag(coyotesHistory), 0);
assert.equal(yearsOnCurrentTeam(coyotesHistory), 3);

console.log("check-team-abbreviations: ok");

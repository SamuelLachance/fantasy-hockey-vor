/**
 * Unit checks for Fantrax → NHL id matching.
 * Run: npx tsx scripts/test-fantrax-match.ts
 */
import {
  fantraxDisplayName,
  groupOfPosition,
  groupsFromEligible,
  matchFantraxToNhl,
  nameKey,
  type FantraxMatchPlayer,
  type NhlMatchCandidate,
} from "../src/lib/fantrax/match";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

// Name keys: apostrophes/dots deleted (not spaced), accents stripped,
// parenthesised nicknames dropped, first-name aliases folded.
assert(nameKey("Ryan O'Reilly") === nameKey(fantraxDisplayName("OReilly, Ryan")), "O'Reilly = OReilly");
assert(nameKey("K'Andre Miller") === nameKey(fantraxDisplayName("Miller, KAndre")), "K'Andre = KAndre");
assert(nameKey("Ben Kindel") === nameKey(fantraxDisplayName("Kindel, Benjamin")), "Ben = Benjamin");
assert(nameKey("Dan Vladar") === nameKey(fantraxDisplayName("Vladar, Daniel")), "Dan = Daniel");
assert(nameKey("Haoxi (Simon) Wang") === nameKey(fantraxDisplayName("Wang, Haoxi")), "parenthesised nickname");
assert(nameKey("Tim Stützle") === nameKey(fantraxDisplayName("Stutzle, Tim")), "accents");
assert(nameKey("J.T. Miller") === nameKey(fantraxDisplayName("Miller, J.T.")), "initials");
assert(nameKey("Matt Murray") === nameKey("Matthew Murray"), "Matt = Matthew");
assert(nameKey("Ryan O'Reilly") !== nameKey("Ryan Reilly"), "O'Reilly != Reilly");
assert(fantraxDisplayName("Hughes, Jack") === "Jack Hughes", "Last, First → First Last");

assert(JSON.stringify([...groupsFromEligible("W,C,F,Skt")]) === '["F"]', "W,C,F,Skt → F");
assert(JSON.stringify([...groupsFromEligible("D,W,F,Skt")].sort()) === '["D","F"]', "D/W dual");
assert(JSON.stringify([...groupsFromEligible("G")]) === '["G"]', "G");
assert(groupOfPosition("LW") === "F" && groupOfPosition("D") === "D", "repo groups");

const fx = (fantraxId: string, name: string, team: string, eligible: string): FantraxMatchPlayer => ({
  fantraxId,
  name,
  team,
  groups: groupsFromEligible(eligible),
});
const nhl = (id: number, name: string, team: string, pos: string): NhlMatchCandidate => ({
  id,
  name,
  team,
  groups: new Set([groupOfPosition(pos)]),
});

const pool: FantraxMatchPlayer[] = [
  fx("oreilly", "OReilly, Ryan", "NSH", "C,F,Skt"),
  fx("oreilly-na", "OReilly, Ryan", "(N/A)", "W,F,Skt"),
  fx("kandre", "Miller, KAndre", "CAR", "D,Skt"),
  fx("kindel", "Kindel, Benjamin", "PIT", "W,C,F,Skt"),
  fx("vladar", "Vladar, Daniel", "PHI", "G"),
  fx("stutzle", "Stutzle, Tim", "OTT", "C,F,Skt"),
  fx("petc", "Pettersson, Elias", "VAN", "C,F,Skt"),
  fx("petd", "Pettersson, Elias", "VAN", "D,Skt"),
  fx("hughes-njd", "Hughes, Jack", "NJD", "W,C,F,Skt"),
  fx("hughes-lak", "Hughes, Jack", "LAK", "W,C,F,Skt"),
  fx("moved", "Kreider, Chris", "MTL", "W,F,Skt"),
  fx("silayev", "Silayev, Anton", "NJD", "D,Skt"),
  fx("geertsen", "Geertsen, Mason", "BUF", "D,Skt"),
  fx("murray-na", "Murray, Matt", "(N/A)", "G"),
  fx("murray-nsh", "Murray, Matthew", "NSH", "G"),
];
const repo: NhlMatchCandidate[] = [
  nhl(8475158, "Ryan O'Reilly", "NSH", "C"),
  nhl(8480817, "K'Andre Miller", "CAR", "D"),
  nhl(8485414, "Ben Kindel", "PIT", "C"),
  nhl(8478435, "Dan Vladar", "PHI", "G"),
  nhl(8482116, "Tim Stützle", "OTT", "C"),
  nhl(8480012, "Elias Pettersson", "VAN", "C"),
  nhl(8483678, "Elias Pettersson", "VAN", "D"),
  nhl(8481559, "Jack Hughes", "NJD", "C"),
  nhl(8475184, "Chris Kreider", "ANA", "LW"),
  nhl(9999999, "Anton Silayev", "NJD", "D"),
  nhl(8477419, "Mason Geertsen", "BUF", "LW"),
  nhl(8483575, "Matt Murray", "NSH", "G"),
  nhl(8476899, "Matt Murray", "SEA", "G"),
];

const m = matchFantraxToNhl(pool, repo, { silayev: null });
const id = (fid: string) => m.get(fid)?.nhlId;
assert(id("oreilly") === 8475158 && m.get("oreilly")?.method === "name-team", "O'Reilly by name + team");
assert(id("oreilly-na") === undefined, "clubless namesake can't reclaim O'Reilly");
assert(id("kandre") === 8480817, "K'Andre Miller");
assert(id("kindel") === 8485414, "Kindel via alias");
assert(id("vladar") === 8478435, "Vladar via alias");
assert(id("stutzle") === 8482116, "Stützle via accents");
assert(id("petc") === 8480012 && id("petd") === 8483678, "Pettersson C vs D resolved by group");
assert(id("hughes-njd") === 8481559, "NJD Jack Hughes");
assert(id("hughes-lak") === undefined, "LAK Jack Hughes never inherits the NJD star");
assert(id("moved") === 8475184 && m.get("moved")?.method === "name", "summer move matched by name only");
assert(id("silayev") === undefined, "override null wins over an exact match");
assert(id("geertsen") === 8477419, "lone same-name same-team player accepted across position groups");
assert(id("murray-nsh") === 8483575, "NSH Matthew Murray by name + team");
assert(id("murray-na") === undefined, "ambiguous Fantrax name never guesses");

const withOverride = matchFantraxToNhl(pool, repo, { "hughes-lak": 8483456, "murray-na": 8476899 });
assert(withOverride.get("hughes-lak")?.nhlId === 8483456, "override maps LAK Hughes");
assert(withOverride.get("murray-na")?.nhlId === 8476899, "override maps clubless Murray");
assert(withOverride.get("hughes-njd")?.nhlId === 8481559, "override leaves NJD Hughes alone");

const claimed = [...m.values()].map((r) => r.nhlId);
assert(new Set(claimed).size === claimed.length, "no NHL id claimed twice");

if (failed) process.exit(1);
console.log("OK: fantrax match");

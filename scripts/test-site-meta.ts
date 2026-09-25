/**
 * Unit checks for shared site metadata copy (French) and the root layout.
 * Run: npx tsx scripts/test-site-meta.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import {
  SITE_TITLE_TEMPLATE,
  siteDefaultDescription,
  siteDefaultTitle,
  siteHomeTitle,
  siteManifestDescription,
} from "../src/lib/site-meta";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

assert(SITE_TITLE_TEMPLATE === "%s | Fantasy Hockey VOR", "title template");
assert(siteDefaultTitle() === "Fantasy Hockey VOR", "default title");
assert(siteHomeTitle() === "Mes ligues | Fantasy Hockey VOR", "home title");
assert(siteDefaultDescription().includes("hockey fantasy"), "French description");
assert(siteManifestDescription().includes("Mes ligues"), "manifest blurb");
for (const s of [siteDefaultDescription(), siteManifestDescription()]) {
  // League names are proper nouns (« Light the Lamp »).
  assert(!/\b(rankings|the|and)\b/i.test(s.replace(/Light the Lamp/g, "")), `no English in ${JSON.stringify(s)}`);
}

const layout = readFileSync(join(process.cwd(), "src/app/layout.tsx"), "utf8");
assert(layout.includes('lang="fr-CA"'), "root layout is French");
assert(layout.includes("template: SITE_TITLE_TEMPLATE"), "root layout sets the title template");
assert(layout.includes("index: false"), "whole site noindex");
assert(layout.includes('locale: "fr_CA"'), "OG locale");
assert(!layout.includes("suppressHydrationWarning"), "no per-page lang switching left to excuse");

const home = readFileSync(join(process.cwd(), "src/app/page.tsx"), "utf8");
assert(home.includes("absolute: siteHomeTitle()"), "home page title ignores the template (root segment)");

// Pages never append the brand themselves: the template does.
for (const rel of [
  "src/app/snake/page.tsx",
  "src/app/league/page.tsx",
  "src/app/draft/light-the-lamp/page.tsx",
  "src/app/ligues/[ligue]/[onglet]/page.tsx",
]) {
  const text = readFileSync(join(process.cwd(), rel), "utf8");
  assert(!/const (title|TITLE) = [^\n]*SITE_BRAND/.test(text), `${rel} leaves the brand to the template`);
  assert(!/^\s+title: `[^`\n]*SITE_BRAND/m.test(text.replace(/(openGraph|twitter): \{[\s\S]*?\}/g, "")), `${rel}: page title without brand`);
}

if (failed) process.exit(1);
console.log("OK: site-meta");

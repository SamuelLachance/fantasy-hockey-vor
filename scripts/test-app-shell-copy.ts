/**
 * Unit checks for loading / error / not-found shell copy (French).
 * Run: npx tsx scripts/test-app-shell-copy.ts
 */
import {
  errorBackHomeCopy,
  errorBoundaryBody,
  errorBoundaryTitle,
  errorReferenceCopy,
  errorTryAgainCopy,
  globalErrorBody,
  globalErrorTitle,
  notFoundBody,
  notFoundTitle,
} from "../src/lib/app-shell-copy";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

assert(errorBoundaryTitle() === "Une erreur est survenue", "error title");
assert(errorBoundaryBody().includes("rechargez"), "error body");
assert(errorTryAgainCopy() === "Réessayer", "try again");
assert(errorBackHomeCopy() === "Retour à l’accueil", "back home");
assert(errorReferenceCopy("abc") === "Référence : abc", "digest reference");
assert(notFoundTitle() === "Page introuvable", "404 title");
assert(notFoundBody() === "Cette adresse n’existe pas ou plus.", "404 body");
assert(globalErrorTitle() === "Erreur de l’application", "global title");
assert(globalErrorBody().includes("Réessayez"), "global body");

const all = [
  errorBoundaryTitle(),
  errorBoundaryBody(),
  errorTryAgainCopy(),
  errorBackHomeCopy(),
  notFoundTitle(),
  notFoundBody(),
  globalErrorTitle(),
  globalErrorBody(),
];
for (const s of all) {
  assert(!/\b(Loading|Something went wrong|Try again|Back to rankings|Page not found|rankings)\b/.test(s), `no English: ${s}`);
}

if (failed) process.exit(1);
console.log("OK: app-shell-copy");

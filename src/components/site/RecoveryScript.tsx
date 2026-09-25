import { recoveryScript } from "@/lib/leagues/legacy";

/**
 * Inline redirect for old addresses and 404s (trailing slash, league
 * root…), before any JavaScript bundle loads. Inline scripts only run on a
 * full page load: `RecoveryEffect` covers client-side arrivals.
 */
export function RecoveryScript() {
  return <script dangerouslySetInnerHTML={{ __html: recoveryScript(process.env.NEXT_PUBLIC_BASE_PATH ?? "") }} />;
}

"use client";

import { useEffect } from "react";
import { recoverTarget } from "@/lib/leagues/legacy";

/**
 * The inline recovery script's fallback: React never runs a `<script>` it
 * inserts during a client-side navigation, so this does the same redirect
 * from an effect (same pure rule, `location.replace`).
 */
export function RecoveryEffect() {
  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
    const { pathname, search, hash } = window.location;
    let path = pathname;
    if (base) {
      if (path === base) path = "/";
      else if (path.startsWith(`${base}/`)) path = path.slice(base.length);
      else return;
    }
    const target = recoverTarget(path, search, hash);
    // Same join as the inline script (withBasePath would also fold "//" in the query).
    if (target !== null) window.location.replace(`${base}${target}`);
  }, []);
  return null;
}

"use client";

import { useEffect } from "react";

/**
 * Switch `<html lang>` while a French page is mounted (the shared root layout
 * says "en") and put it back on the way out (client navigation). The page
 * also sets it before first paint with an inline script.
 */
export function useDocumentLang(lang: string): void {
  useEffect(() => {
    const root = document.documentElement;
    const prev = root.lang;
    root.lang = lang;
    return () => {
      root.lang = prev && prev !== lang ? prev : "en";
    };
  }, [lang]);
}

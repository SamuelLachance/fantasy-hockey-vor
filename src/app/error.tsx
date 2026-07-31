"use client";

import { useEffect } from "react";
import { homeRankingsHref } from "@/lib/site";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <p className="text-sm font-medium uppercase tracking-[0.2em] text-cyan-400">
        Fantasy Hockey VOR
      </p>
      <h1 className="text-2xl font-semibold text-white">Something went wrong</h1>
      <p className="max-w-md text-sm text-slate-400">
        The rankings UI hit an unexpected error. Your data files are usually
        fine — try again, or hard-refresh.
      </p>
      {error.digest ? (
        <p className="font-mono text-xs text-slate-600">
          Ref {error.digest}
        </p>
      ) : null}
      <button
        type="button"
        onClick={() => reset()}
        className="rounded-full bg-cyan-500 px-5 py-2 text-sm font-semibold text-slate-950 transition motion-reduce:transition-none hover:bg-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
      >
        Try again
      </button>
      <a
        href={homeRankingsHref()}
        className="text-sm text-cyan-400/90 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
      >
        Back to rankings
      </a>
    </main>
  );
}

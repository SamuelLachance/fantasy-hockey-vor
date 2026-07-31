"use client";

import { homeRankingsHref } from "@/lib/site";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  void error;
  return (
    <html lang="en">
      <body className="bg-slate-950 text-slate-100">
        <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
          <h1 className="text-2xl font-semibold">App error</h1>
          <p className="max-w-md text-sm text-slate-400">
            A root-level failure occurred. Retry to remount the application.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-full bg-cyan-500 px-5 py-2 text-sm font-semibold text-slate-950 transition motion-reduce:transition-none hover:bg-cyan-400"
          >
            Try again
          </button>
          <a
            href={homeRankingsHref()}
            className="text-sm text-cyan-400/90 underline-offset-2 hover:underline"
          >
            Back to rankings
          </a>
        </main>
      </body>
    </html>
  );
}

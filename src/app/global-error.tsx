"use client";

import { BrandEyebrow } from "@/components/BrandEyebrow";
import {
  errorBackToRankingsCopy,
  errorTryAgainCopy,
  globalErrorBody,
  globalErrorTitle,
} from "@/lib/app-shell-copy";
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
          <BrandEyebrow />
          <h1 className="text-2xl font-semibold">{globalErrorTitle()}</h1>
          <p className="max-w-md text-sm text-slate-400">{globalErrorBody()}</p>
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-full bg-cyan-500 px-5 py-2 text-sm font-semibold text-slate-950 transition motion-reduce:transition-none hover:bg-cyan-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200"
          >
            {errorTryAgainCopy()}
          </button>
          <a
            href={homeRankingsHref()}
            className="text-sm text-cyan-400/90 underline-offset-2 hover:underline"
          >
            {errorBackToRankingsCopy()}
          </a>
        </main>
      </body>
    </html>
  );
}

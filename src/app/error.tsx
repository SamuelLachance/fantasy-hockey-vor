"use client";

import { useEffect } from "react";
import { BrandEyebrow } from "@/components/BrandEyebrow";
import {
  errorBackHomeCopy,
  errorBoundaryBody,
  errorBoundaryTitle,
  errorReferenceCopy,
  errorTryAgainCopy,
} from "@/lib/app-shell-copy";
import { homeHref } from "@/lib/leagues/routes";

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
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <BrandEyebrow />
      <h1 className="text-2xl font-semibold text-white">{errorBoundaryTitle()}</h1>
      <p className="max-w-md text-sm text-slate-400">{errorBoundaryBody()}</p>
      {error.digest ? <p className="font-mono text-xs text-slate-400">{errorReferenceCopy(error.digest)}</p> : null}
      <button
        type="button"
        onClick={() => reset()}
        className="min-h-11 rounded-full bg-cyan-500 px-5 py-2 text-sm font-semibold text-slate-950 transition motion-reduce:transition-none hover:bg-cyan-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
      >
        {errorTryAgainCopy()}
      </button>
      <a
        href={homeHref()}
        className="inline-flex min-h-11 items-center text-sm text-cyan-400/90 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
      >
        {errorBackHomeCopy()}
      </a>
    </div>
  );
}

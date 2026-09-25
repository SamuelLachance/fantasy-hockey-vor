import Link from "next/link";
import { ArrowRight, Mic } from "lucide-react";
import { SnakeDisclaimerShort } from "@/components/snake/SnakeDisclaimer";
import type { SnakeHomeData } from "@/lib/leagues/home-summary";
import { snakePath } from "@/lib/leagues/routes";

/** « Les opinions de Snake » on the home page: size of the database, disclaimer, link. */
export function SnakeHomeCard({ data }: { data: SnakeHomeData }) {
  return (
    <section
      aria-labelledby="accueil-snake"
      className="flex flex-col gap-3 rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-slate-900/80 to-slate-950/80 p-4 sm:p-6"
    >
      <div className="flex items-center gap-2 text-emerald-300">
        <Mic className="h-5 w-5 shrink-0" aria-hidden="true" />
        <h2 id="accueil-snake" className="text-xl font-bold tracking-tight text-white">
          Les opinions de Snake
        </h2>
      </div>
      <p className="text-sm text-slate-300">{data.text}</p>
      <SnakeDisclaimerShort className="max-w-3xl" />
      <p>
        <Link
          href={snakePath()}
          prefetch={false}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-emerald-400/40 bg-emerald-500/10 px-4 text-sm font-semibold text-emerald-100 transition motion-reduce:transition-none hover:bg-emerald-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
        >
          Explorer la base
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </p>
    </section>
  );
}

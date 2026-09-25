import { BrandEyebrow } from "@/components/BrandEyebrow";

// The root loading.tsx talks about "rankings"; this route gets its own copy.
export default function Loading() {
  return (
    <main lang="fr-CA" className="flex min-h-[40vh] flex-col items-center justify-center px-4 py-20">
      <div className="flex flex-col items-center justify-center gap-4 text-center" role="status" aria-busy="true">
        <BrandEyebrow className="text-xs text-cyan-400/80" />
        <div className="h-1 w-40 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
          <div className="h-full w-1/2 animate-pulse rounded-full bg-cyan-400/60 motion-reduce:animate-none" />
        </div>
        <p className="text-sm text-slate-400">{"Chargement de l'aide quotidienne…"}</p>
      </div>
    </main>
  );
}

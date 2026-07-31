export default function Loading() {
  return (
    <main className="flex min-h-[40vh] flex-col items-center justify-center gap-4 px-4 py-20">
      <div
        className="h-1 w-40 overflow-hidden rounded-full bg-white/10"
        aria-hidden
      >
        <div className="h-full w-1/2 animate-pulse rounded-full bg-cyan-400/60" />
      </div>
      <p className="text-sm text-slate-400" role="status">
        Loading rankings…
      </p>
    </main>
  );
}

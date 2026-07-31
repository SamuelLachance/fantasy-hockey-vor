import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="text-sm font-medium uppercase tracking-[0.2em] text-cyan-400">
        Fantasy Hockey VOR
      </p>
      <h1 className="text-3xl font-bold text-white">Page not found</h1>
      <p className="max-w-md text-slate-400">
        That route is not part of the rankings app. Head back to the full board.
      </p>
      <Link
        href="/#rankings"
        className="rounded-full bg-cyan-500 px-5 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
      >
        Back to rankings
      </Link>
    </main>
  );
}

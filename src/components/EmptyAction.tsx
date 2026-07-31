"use client";

interface EmptyActionProps {
  label: string;
  onClick: () => void;
  primary?: boolean;
  keyshortcuts?: string;
}

/** Recovery action chip used by the empty board state. */
export function EmptyAction({
  label,
  onClick,
  primary = false,
  keyshortcuts,
}: EmptyActionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-keyshortcuts={keyshortcuts}
      className={
        primary
          ? "inline-flex min-h-11 min-w-[2.75rem] items-center justify-center rounded-full bg-cyan-500/15 px-4 py-1.5 text-sm font-medium text-cyan-200 transition hover:bg-cyan-500/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
          : "inline-flex min-h-11 min-w-[2.75rem] items-center justify-center rounded-full bg-white/5 px-4 py-1.5 text-sm text-slate-300 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
      }
    >
      {label}
    </button>
  );
}

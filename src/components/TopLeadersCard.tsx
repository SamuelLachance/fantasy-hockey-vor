import type { ReactNode } from "react";

interface TopLeadersCardProps {
  icon: ReactNode;
  title: string;
  accentClass: string;
  description?: string;
  headerExtra?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** Shared chrome for TopPlayers leader panels. */
export function TopLeadersCard({
  icon,
  title,
  accentClass,
  description,
  headerExtra,
  className = "",
  children,
}: TopLeadersCardProps) {
  return (
    <div
      className={`rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900/80 to-slate-950/80 p-6 ${className}`}
    >
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className={`flex items-center gap-2 ${accentClass}`}>
          {icon}
          <h2 className="text-lg font-semibold text-white">{title}</h2>
        </div>
        {headerExtra}
      </div>
      {description ? (
        <p className="mb-3 text-xs text-slate-500">{description}</p>
      ) : null}
      {children}
    </div>
  );
}

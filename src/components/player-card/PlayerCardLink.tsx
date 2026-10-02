import Link from "next/link";
import type { ReactNode } from "react";
import { playerCardPath } from "@/lib/player-card";

/**
 * A player's name as a link to his card (/joueur): by NHL id, or by his
 * Fantrax id in a league. Without either it stays plain text.
 */
export function PlayerCardLink({
  nhl,
  fx,
  league,
  children,
  className = "hover:text-cyan-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 rounded-sm",
}: {
  nhl?: number | null;
  fx?: string | null;
  league?: string | null;
  children: ReactNode;
  className?: string;
}) {
  const href = playerCardPath({ nhl, fx, league });
  if (!href) return <>{children}</>;
  return (
    <Link href={href} className={className} prefetch={false}>
      {children}
    </Link>
  );
}

import type { ReactNode } from "react";

/**
 * A player's details row: one cell across the table, its content pinned to
 * the left and never wider than the screen, so it stays in view however
 * far the table is scrolled sideways.
 */
export function PlayerTableDetail({ id, colSpan, children }: { id: string; colSpan: number; children: ReactNode }) {
  return (
    <tr id={id} className="bg-white/[0.02]">
      <td colSpan={colSpan} className="px-3 pb-4 pt-1 text-sm">
        <div className="sticky left-3 w-[min(48rem,calc(100vw-3.5rem))]">{children}</div>
      </td>
    </tr>
  );
}

"use client";

/**
 * Board-side Snake lookup (NHL id → key / verdict / trend): a tiny external
 * store so every row can read it with `useSyncExternalStore`. The file is
 * fetched once, when the browser is idle (not on Save-Data), or on demand
 * when a player panel opens. Nothing ships in the prerendered HTML.
 */
import { useSyncExternalStore } from "react";
import { prefersSaveData, scheduleIdle } from "@/lib/schedule-idle";
import { loadSnakeNhl } from "./client";
import type { SnakeNhlEntry, SnakeNhlFile } from "./types";

type Rows = SnakeNhlFile["rows"];
export type SnakeBoardStatus = "idle" | "loading" | "ready" | "error";

let rows: Rows | null = null;
let status: SnakeBoardStatus = "idle";
let idleArmed = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

/** Start the fetch now (no-op when loading or loaded). */
export function ensureSnakeBoard(): void {
  if (status === "loading" || status === "ready") return;
  status = "loading";
  emit();
  loadSnakeNhl().then(
    (d) => {
      rows = d.rows;
      status = "ready";
      emit();
    },
    () => {
      status = "error";
      emit();
    },
  );
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  if (!idleArmed && status === "idle" && !prefersSaveData()) {
    idleArmed = true;
    scheduleIdle(ensureSnakeBoard, 1_500);
  }
  return () => {
    listeners.delete(cb);
  };
}

const getRows = () => rows;
const getStatus = () => status;
const serverRows = () => null;
const serverStatus = (): SnakeBoardStatus => "idle";

/** Snake entry for a board player (null until loaded, or when he has none). */
export function useSnakeBoardEntry(playerId: number): SnakeNhlEntry | null {
  const r = useSyncExternalStore(subscribe, getRows, serverRows);
  return r?.[String(playerId)] ?? null;
}

export function useSnakeBoardStatus(): SnakeBoardStatus {
  return useSyncExternalStore(subscribe, getStatus, serverStatus);
}

"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from "react";
import { probAvailableAt } from "@/lib/draft/availability";
import { DRAFT_FILTERS, draftRows, type DraftFilter, type DraftRow } from "@/lib/draft/board-filter";
import type { DraftBoard } from "@/lib/draft/board-types";
import { pickLabel, pickOwnerMismatch } from "@/lib/draft/draft-copy";
import {
  EMPTY_DRAFT_STATE,
  UNLISTED_PLAYER_ID,
  markPick,
  pickedIds,
  removePickAt,
  setDraftSlot,
  setPickMine,
  undoLastPick,
  type DraftState,
} from "@/lib/draft/draft-state";
import { getDraftStore } from "@/lib/draft/draft-store";
import { pickInfo } from "@/lib/draft/snake";
import { suggestPicks } from "@/lib/draft/suggestions";
import { categoryTargets } from "@/lib/draft/team";
import { DraftBoardList, draftRowId } from "./DraftBoardList";
import { DraftMethodNote } from "./DraftMethodNote";
import { DraftMyTeam } from "./DraftMyTeam";
import { DraftPickLog } from "./DraftPickLog";
import { DraftStatusBar } from "./DraftStatusBar";
import { DraftSuggestions } from "./DraftSuggestions";
import { DraftTools } from "./DraftTools";

const PAGE = 80;
const TOAST_MS = 4000;
const WARN_TOAST_MS = 9000;
const HISTORY_MAX = 200;
/** Printable keys typed outside a field that start a search (letters, name punctuation). */
const TYPE_TO_SEARCH = /^[\p{L}'’.-]$/u;

interface ToastAction {
  label: string;
  run: () => void;
}

interface Toast {
  text: string;
  warn?: boolean;
  actions: ToastAction[];
}

/**
 * One undoable step: the whole state before and after. Undo restores
 * `before` for any action (mark, remove, owner flip, slot, import, reset),
 * but only while the store still holds exactly `after` — a reload or a
 * change from another tab invalidates the stack, and undo falls back to
 * dropping the last pick.
 */
interface HistoryEntry {
  before: DraftState;
  after: DraftState;
  label: string;
}

function playerName(byId: Map<number, { name: string }>, id: number): string {
  return id === UNLISTED_PLAYER_ID ? "Joueur hors liste" : (byId.get(id)?.name ?? "Joueur");
}

function coarsePointer(): boolean {
  try {
    return window.matchMedia?.("(pointer: coarse)").matches ?? false;
  } catch (_error) {
    return false;
  }
}

export function DraftHelper({ board }: { board: DraftBoard }) {
  const teams = board.league.teams;
  const store = getDraftStore(board.slug, teams);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  const persistent = useSyncExternalStore(store.subscribe, store.persistent, () => true);

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<DraftFilter>("ALL");
  const [showDrafted, setShowDrafted] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [active, setActive] = useState({ q: "", i: 0 });
  const [lastMarkAt, setLastMarkAt] = useState<number | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [historySize, setHistorySize] = useState(0);
  const toastTimer = useRef<number | null>(null);
  const history = useRef<HistoryEntry[]>([]);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const byId = useMemo(() => new Map(board.players.map((p) => [p.id, p])), [board]);
  const knownIds = useMemo(() => new Set(board.players.map((p) => p.id)), [board]);

  const result = useMemo(() => suggestPicks(board, state), [board, state]);
  const { timeline, suggestions, lineup, strength } = result;
  const targets = useMemo(() => categoryTargets(strength), [strength]);
  const onTheClock = timeline.onTheClock;

  const rows = useMemo(
    () => draftRows(board.players, state, { filter, query, showDrafted }),
    [board, state, filter, query, showDrafted],
  );
  const remaining = board.players.length - pickedIds(state).size;
  // The highlighted row is always one that can still be drafted (with
  // « Voir repêchés » on, drafted rows are skipped), so Entrée marks exactly
  // the row that is lit. -1 = nothing to mark.
  const activeIndex = useMemo(() => {
    if (active.q === query) {
      const i = Math.min(active.i, rows.length - 1);
      if (i >= 0 && rows[i]?.pickNumber == null) return i;
    }
    return rows.findIndex((r) => r.pickNumber == null);
  }, [active, query, rows]);

  // The availability column answers "will he be there at my *next* turn?":
  // on the clock that is the following pick, otherwise the target pick.
  const availabilityPick = onTheClock ? timeline.followingPick : timeline.targetPick;
  const availabilityFor = useCallback(
    (row: DraftRow) =>
      availabilityPick == null || row.pickNumber != null
        ? null
        : probAvailableAt(row.player, timeline.currentPick, availabilityPick),
    [availabilityPick, timeline.currentPick],
  );

  const showToast = useCallback((next: Toast) => {
    setToast(next);
    if (toastTimer.current != null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), next.warn ? WARN_TOAST_MS : TOAST_MS);
  }, []);

  /** Apply a new state and remember how to go back. */
  const commit = useCallback(
    (next: DraftState, label: string): boolean => {
      const before = store.getSnapshot();
      if (next === before) return false;
      store.set(next);
      const stack = history.current;
      stack.push({ before, after: store.getSnapshot(), label });
      if (stack.length > HISTORY_MAX) stack.splice(0, stack.length - HISTORY_MAX);
      setHistorySize(stack.length);
      return true;
    },
    [store],
  );

  const onUndo = useCallback(() => {
    const current = store.getSnapshot();
    const stack = history.current;
    const top = stack.at(-1);
    if (top && top.after === current) {
      stack.pop();
      store.set(top.before);
      setHistorySize(stack.length);
      showToast({ text: `Annulé : ${top.label}`, actions: [] });
      return;
    }
    // Stack is stale (reload, other tab): drop the last pick, as before.
    history.current = [];
    setHistorySize(0);
    const last = current.picks.at(-1);
    if (!last) return;
    store.set(undoLastPick(current));
    showToast({
      text: `Annulé : ${playerName(byId, last.id)} (${pickLabel(current.picks.length)})`,
      actions: [],
    });
  }, [store, byId, showToast]);

  const undoAction = useMemo<ToastAction>(() => ({ label: "Annuler", run: onUndo }), [onUndo]);

  const onToggleMine = useCallback(
    (index: number) => {
      const before = store.getSnapshot();
      const pick = before.picks[index];
      if (!pick) return;
      const mine = !pick.mine;
      const label = `${pickLabel(index + 1)} ${playerName(byId, pick.id)} → ${mine ? "mon équipe" : "autre équipe"}`;
      if (!commit(setPickMine(before, index, mine), label)) return;
      showToast({ text: label, actions: [undoAction] });
    },
    [store, byId, commit, showToast, undoAction],
  );

  const onMark = useCallback(
    (id: number, mine: boolean) => {
      const before = store.getSnapshot();
      const next = markPick(before, id, mine);
      const n = next.picks.length;
      const label = `${playerName(byId, id)} → ${mine ? "mon équipe" : "repêché"} (${pickLabel(n)})`;
      if (!commit(next, label)) return;
      setLastMarkAt(Date.now());
      // The searched player just left the board: clear for the next name.
      setQuery("");
      const owner = pickInfo(n, teams).slot;
      const mismatch = pickOwnerMismatch(owner, before.slot, mine);
      if (mismatch) {
        showToast({
          warn: true,
          text:
            mismatch === "my-pick-marked-other"
              ? `${label} — attention : le ${pickLabel(n)} est le vôtre.`
              : `${label} — attention : le ${pickLabel(n)} appartient à la position ${owner}.`,
          actions: [
            {
              label: mismatch === "my-pick-marked-other" ? "C’était mon choix" : "Pas mon choix",
              run: () => onToggleMine(n - 1),
            },
            undoAction,
          ],
        });
        return;
      }
      showToast({ text: label, actions: [undoAction] });
    },
    [store, byId, commit, teams, showToast, onToggleMine, undoAction],
  );

  const onRemove = useCallback(
    (index: number) => {
      const before = store.getSnapshot();
      const pick = before.picks[index];
      if (!pick) return;
      const name = playerName(byId, pick.id);
      if (!commit(removePickAt(before, index), `retrait de ${name} (${pickLabel(index + 1)})`)) return;
      showToast({
        text: `Retiré : ${name} (${pickLabel(index + 1)}) — les choix suivants reculent d’un rang`,
        actions: [undoAction],
      });
    },
    [store, byId, commit, showToast, undoAction],
  );

  const onSlot = useCallback(
    (slot: number | null) => {
      const before = store.getSnapshot();
      const label = `position ${before.slot ?? "—"} → ${slot ?? "—"}`;
      if (!commit(setDraftSlot(before, slot, teams), label)) return;
      // Mid-draft, a slot change re-labels every pick to come: say so.
      if (before.picks.length > 0) {
        showToast({ text: `Ma position : ${before.slot ?? "—"} → ${slot ?? "—"}`, actions: [undoAction] });
      }
    },
    [store, commit, teams, showToast, undoAction],
  );

  const onImport = useCallback(
    (next: DraftState) => {
      if (commit(next, `import (${next.picks.length} choix)`)) {
        showToast({ text: `Importé : ${next.picks.length} choix`, actions: [undoAction] });
      }
    },
    [commit, showToast, undoAction],
  );

  const onReset = useCallback(() => {
    if (commit(EMPTY_DRAFT_STATE, "réinitialisation")) {
      setLastMarkAt(null);
      showToast({ text: "Repêchage réinitialisé", actions: [undoAction] });
    }
  }, [commit, showToast, undoAction]);

  /** Focus the search; scroll it into view only when needed. */
  const focusSearch = useCallback((scroll: "if-needed" | "always") => {
    const input = searchRef.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    const barH = barRef.current?.offsetHeight ?? 0;
    const rect = input.getBoundingClientRect();
    if (scroll === "always" || rect.top < barH || rect.bottom > window.innerHeight) {
      window.scrollTo({ top: rect.top + window.scrollY - barH - 12, behavior: "auto" });
    }
  }, []);

  const onJumpToSearch = useCallback(() => focusSearch("always"), [focusSearch]);

  const onUnlisted = useCallback(() => onMark(UNLISTED_PLAYER_ID, onTheClock), [onMark, onTheClock]);

  const onQuery = useCallback((q: string) => {
    setQuery(q);
    setLimit(PAGE);
  }, []);
  const onFilter = useCallback((f: DraftFilter) => {
    setFilter(f);
    setLimit(PAGE);
  }, []);

  const moveActive = (delta: number) => {
    if (activeIndex < 0) return;
    let i = activeIndex + delta;
    while (i >= 0 && i < rows.length && rows[i]!.pickNumber != null) i += delta;
    if (i < 0 || i >= rows.length) return;
    setActive({ q: query, i });
    if (i >= limit) setLimit(i + 1);
    const id = rows[i]?.player.id;
    if (id != null) {
      window.requestAnimationFrame(() =>
        document.getElementById(draftRowId(id))?.scrollIntoView({ block: "nearest" }),
      );
    }
  };

  const onSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "z") {
      // Empty search: no text to undo, so undo the last draft action.
      if (query === "") {
        e.preventDefault();
        onUndo();
      }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      moveActive(e.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (e.key === "Escape") {
      if (query !== "") {
        e.preventDefault();
        onQuery("");
      } else {
        e.currentTarget.blur();
      }
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      // Phones and tablets: the keyboard's OK key only closes the keyboard.
      // Marking is always an explicit Pris / Moi tap there (no Shift+Entrée,
      // and a confirmation could hide behind the keyboard).
      if (coarsePointer()) {
        e.currentTarget.blur();
        return;
      }
      if (query.trim() === "" || activeIndex < 0) return;
      const target = rows[activeIndex];
      if (!target || target.pickNumber != null) return;
      // On the clock Entrée is our pick, otherwise another team's; Shift
      // inverts either way.
      onMark(target.player.id, onTheClock ? !e.shiftKey : e.shiftKey);
    }
  };

  // Global keys outside text fields. No bare-letter shortcut: letters go to
  // the search (type-to-search), so typing a name after a button mark (focus
  // on <body>) can never undo or toggle anything.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest?.("input, textarea, select, [contenteditable='true']")) return;
      if (e.altKey) return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        onUndo();
        return;
      }
      if (e.ctrlKey || e.metaKey) return;
      if (e.key === "/") {
        e.preventDefault();
        focusSearch("if-needed");
        return;
      }
      if (/^[1-7]$/.test(e.key)) {
        onFilter(DRAFT_FILTERS[Number(e.key) - 1]!);
        return;
      }
      if (TYPE_TO_SEARCH.test(e.key)) {
        e.preventDefault();
        focusSearch("if-needed");
        setQuery((q) => q + e.key);
        setLimit(PAGE);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onUndo, onFilter, focusSearch]);

  // Expose the sticky bar's height so the desktop columns stick under it.
  useEffect(() => {
    const bar = barRef.current;
    const root = rootRef.current;
    if (!bar || !root || typeof ResizeObserver === "undefined") return;
    const apply = () => root.style.setProperty("--draft-bar-h", `${bar.offsetHeight}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(bar);
    return () => ro.disconnect();
  }, []);

  useEffect(
    () => () => {
      if (toastTimer.current != null) window.clearTimeout(toastTimer.current);
    },
    [],
  );

  const columnClass =
    "lg:sticky lg:top-[calc(var(--draft-bar-h,3.5rem)+0.75rem)] lg:max-h-[calc(100dvh-var(--draft-bar-h,3.5rem)-1.5rem)] lg:overflow-y-auto lg:overscroll-contain";

  return (
    <div ref={rootRef}>
      <DraftStatusBar
        barRef={barRef}
        timeline={timeline}
        teams={teams}
        slot={state.slot}
        onSlot={onSlot}
        onUndo={onUndo}
        canUndo={state.picks.length > 0 || historySize > 0}
        lastMarkAt={lastMarkAt}
        pickSeconds={board.league.pickSeconds}
        onSearch={onJumpToSearch}
      />

      <div className="mx-auto flex max-w-[120rem] flex-col gap-4 px-4 py-4 sm:px-6 lg:grid lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start lg:px-8 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className={`order-2 min-w-0 lg:order-none ${columnClass} rounded-2xl`}>
          <DraftBoardList
            rows={rows}
            limit={limit}
            onShowMore={() => setLimit((n) => n + PAGE)}
            skaterCategories={board.categories.skater}
            goalieCategories={board.categories.goalie}
            filter={filter}
            onFilter={onFilter}
            query={query}
            onQuery={onQuery}
            onSearchKeyDown={onSearchKeyDown}
            searchRef={searchRef}
            showDrafted={showDrafted}
            onToggleDrafted={() => setShowDrafted((v) => !v)}
            activeIndex={activeIndex}
            onTheClock={onTheClock}
            skaterGroupOffset={board.skaterGroupOffset}
            availabilityFor={availabilityFor}
            availabilityPick={availabilityPick}
            onMark={onMark}
            onRemove={onRemove}
            onUnlisted={onUnlisted}
            remaining={remaining}
          />
        </div>

        <aside aria-label="Mon repêchage" className={`contents lg:flex lg:flex-col lg:gap-4 ${columnClass}`}>
          <div className="order-1">
            <DraftSuggestions
              suggestions={suggestions}
              timeline={timeline}
              hasSlot={state.slot != null}
              skaterCategories={board.categories.skater}
              goalieCategories={board.categories.goalie}
              onMark={onMark}
            />
          </div>
          <div className="order-3">
            <DraftMyTeam
              board={board}
              lineup={lineup}
              strength={strength}
              targets={targets}
              myPicks={timeline.myPicks}
              currentPick={timeline.currentPick}
            />
          </div>
          <div className="order-4">
            <DraftPickLog
              picks={state.picks}
              byId={byId}
              teams={teams}
              slot={state.slot}
              onRemove={onRemove}
              onToggleMine={onToggleMine}
            />
          </div>
          <div className="order-5">
            <DraftTools
              slug={board.slug}
              teams={teams}
              state={state}
              knownIds={knownIds}
              persistent={persistent}
              onImport={onImport}
              onReset={onReset}
            />
          </div>
          <div className="order-6">
            <DraftMethodNote board={board} />
          </div>
        </aside>
      </div>

      {/* Bottom-left and narrow: never over the Pris / Moi / Mon choix
          buttons at the right edge of every row and suggestion card. */}
      <div className="pointer-events-none fixed bottom-0 left-0 z-40 pb-[max(1rem,env(safe-area-inset-bottom,0px))] pl-4 sm:pl-6 lg:pl-8">
        <div role="status" aria-live="polite">
          {toast ? (
            <div
              className={`pointer-events-auto flex max-w-[calc(100vw-9rem)] flex-col gap-1.5 rounded-xl border px-3 py-2 text-sm shadow-lg shadow-black/40 sm:max-w-sm ${
                toast.warn
                  ? "border-amber-300/50 bg-amber-950/95 text-amber-50"
                  : "border-white/15 bg-slate-900/95 text-slate-100"
              }`}
            >
              <span className="min-w-0 break-words">{toast.text}</span>
              {toast.actions.length > 0 ? (
                <span className="flex flex-wrap gap-1.5">
                  {toast.actions.map((a) => (
                    <button
                      key={a.label}
                      type="button"
                      onClick={() => {
                        setToast(null);
                        a.run();
                      }}
                      className="min-h-9 shrink-0 rounded-lg bg-white/10 px-3 text-xs font-semibold text-cyan-200 hover:bg-white/20"
                    >
                      {a.label}
                    </button>
                  ))}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

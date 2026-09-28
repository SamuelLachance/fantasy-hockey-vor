"use client";

import { BellOff, BellRing } from "lucide-react";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { ordinal, pickLabel } from "@/lib/fantrax/league-copy";
import { pickOnTheClock } from "@/lib/fantrax/live";
import { turnAlertKey, withTurnPrefix } from "@/lib/fantrax/turn-cue";
import { useFantraxLeague } from "./fantrax-league-context";

/**
 * While a league's draft runs (mounted by the league provider, so on every
 * tab, and client-only): « C’EST À TOI · » in front of the browser tab's
 * title whenever the user's own team is on the clock by a LIVE read — kept
 * there when Next rewrites the title on a tab change, and taken off the
 * current title (not a saved one) when the turn passes. For a user who opted
 * in (`TurnAlertToggle`), a system notification and a short sound, once per
 * pick.
 */

const OPT_IN_EVENT = "fantrax-turn-alert";

function readOptIn(slug: string): boolean {
  try {
    return globalThis.localStorage?.getItem(turnAlertKey(slug)) === "1";
  } catch {
    return false;
  }
}

function writeOptIn(slug: string, on: boolean): void {
  try {
    if (on) globalThis.localStorage?.setItem(turnAlertKey(slug), "1");
    else globalThis.localStorage?.removeItem(turnAlertKey(slug));
  } catch {
    // Not remembered; the choice still applies to this page.
  }
  window.dispatchEvent(new Event(OPT_IN_EVENT));
}

function subscribeOptIn(cb: () => void): () => void {
  window.addEventListener(OPT_IN_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(OPT_IN_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

function useTurnAlertOptIn(slug: string): boolean {
  return useSyncExternalStore(
    subscribeOptIn,
    () => readOptIn(slug),
    () => false,
  );
}

let audio: AudioContext | null = null;

/** Created (or resumed) on the opt-in click, which is what lets it play later from a background tab. */
function unlockAudio(): void {
  try {
    const Ctx = globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audio ??= new Ctx();
    void audio.resume();
  } catch {
    audio = null;
  }
}

/** Three short rising beeps. */
function beep(): void {
  try {
    unlockAudio();
    const ctx = audio;
    if (!ctx) return;
    [660, 880, 1100].forEach((hz, i) => {
      const t = ctx.currentTime + i * 0.22;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = hz;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.2);
    });
  } catch {
    // No sound: the title and the notification still say it.
  }
}

function notify(title: string, body: string, tag: string): void {
  try {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const n = new Notification(title, { body, tag });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    // Some mobile browsers only notify from a service worker: the title still says it.
  }
}

export function DraftTurnWatcher() {
  const { state, draftLive, defaultTeamId, config, leagueName } = useFantraxLeague();
  const cur = pickOnTheClock(state?.draft);
  const myTurn = draftLive.cue && !!cur && cur.teamId === defaultTeamId;
  const pick = myTurn ? cur!.pick : null;
  const round = myTurn ? cur!.round : null;

  useEffect(() => {
    const apply = () => {
      const t = withTurnPrefix(document.title, myTurn);
      if (t !== document.title) document.title = t;
    };
    apply();
    if (!myTurn) return;
    // Next sets each tab's own <title> after a client navigation: put the cue back.
    const obs = new MutationObserver(apply);
    obs.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => {
      obs.disconnect();
      document.title = withTurnPrefix(document.title, false);
    };
  }, [myTurn]);

  const optIn = useTurnAlertOptIn(config.slug);
  const alerted = useRef<number | null>(null);
  useEffect(() => {
    if (pick === null || !optIn || alerted.current === pick) return;
    alerted.current = pick;
    notify("C’EST À TOI", `${leagueName} : choix ${pickLabel(pick)} (${ordinal(round ?? 1)} ronde).`, `${config.slug}-turn`);
    beep();
  }, [pick, round, optIn, config.slug, leagueName]);
  return null;
}

/**
 * The opt-in, on the Repêchage tab: a notification and a sound when the
 * user's team goes on the clock (the tab may be in the background, not
 * closed). Off by default; remembered per league on this device.
 */
export function TurnAlertToggle() {
  const { config } = useFantraxLeague();
  const on = useTurnAlertOptIn(config.slug);
  // Client-only component (never prerendered): the permission can be read here.
  const denied = typeof Notification === "undefined" || Notification.permission === "denied";
  const toggle = async () => {
    if (on) {
      writeOptIn(config.slug, false);
      return;
    }
    unlockAudio();
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      try {
        await Notification.requestPermission();
      } catch {
        // Older Safari: callback form only; the sound and the title remain.
      }
    }
    writeOptIn(config.slug, true);
  };
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
      <button
        type="button"
        onClick={toggle}
        aria-pressed={on}
        className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3 text-sm text-slate-200 hover:border-amber-300/50 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
      >
        {on ? <BellRing className="h-4 w-4 text-amber-200" aria-hidden="true" /> : <BellOff className="h-4 w-4" aria-hidden="true" />}
        {on ? "Alerte de tour activée (notification et son)" : "M’avertir quand c’est mon tour"}
      </button>
      <span>
        {on
          ? denied
            ? "Notifications refusées ou non offertes par ce navigateur : le son et le titre de l’onglet vous préviendront. Gardez la page ouverte (en arrière-plan, c’est correct)."
            : "Gardez la page ouverte, même en arrière-plan : elle relit Fantrax et vous prévient à votre tour."
          : "Le titre de l’onglet affiche déjà « C’EST À TOI » à votre tour."}
      </span>
    </p>
  );
}

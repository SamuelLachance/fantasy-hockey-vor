"use client";

import { Activity, Briefcase, CalendarRange, ExternalLink, LineChart, Mic, ShieldCheck, Trophy } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { fmtMoney } from "@/lib/fantrax/money";
import { leaguePlayerPath, leagueTabPath, snakePath } from "@/lib/leagues/routes";
import { ageOn, cardShardFile, type CardFile, type FantraxCardPart, type LtlCardPart, type PlayerCardData } from "@/lib/player-card";
import { withBasePath } from "@/lib/site";

interface LeagueInfo {
  slug: string;
  name: string;
  myTeamId: string;
  kind: string;
}

const PHASE_FR: Record<string, string> = {
  prospect: "Espoir",
  rising: "En progression",
  entering_prime: "Entre dans son prime",
  prime: "Dans son prime",
  plateau: "Plateau",
  declining: "En déclin",
  late_career: "Fin de carrière",
};
const STATUS_FR: Record<string, string> = { ACTIVE: "Actif", RESERVE: "Réserve", MINORS: "Mineures", INJURED_RESERVE: "Blessé (IR)" };
const KEEPER_FR: Record<string, string> = { core: "Protégé à l’écrémage", bubble: "Sur la ligne à l’écrémage", rental: "Location (pas protégé)", free: "Gratuit (mineures)" };
const VERDICT_TONE: Record<string, string> = {
  "très positif": "text-emerald-200 bg-emerald-500/10 ring-emerald-500/30",
  positif: "text-emerald-200 bg-emerald-500/10 ring-emerald-500/30",
  mitigé: "text-amber-200 bg-amber-500/10 ring-amber-500/30",
  négatif: "text-rose-200 bg-rose-500/10 ring-rose-500/30",
  "très négatif": "text-rose-200 bg-rose-500/10 ring-rose-500/30",
};
const POS_FR: Record<string, string> = { C: "Centre", LW: "Ailier gauche", RW: "Ailier droit", L: "Ailier gauche", R: "Ailier droit", D: "Défenseur", G: "Gardien" };
const SEASON0 = 2026;
const INJ_FR: Record<string, string> = {
  "Day-To-Day": "Au jour le jour",
  Out: "Absent",
  "Injured Reserve": "Liste des blessés",
  Suspension: "Suspendu",
};
const INJ_TYPE_FR: Record<string, string> = {
  Shoulder: "épaule",
  "Upper Body": "haut du corps",
  "Lower Body": "bas du corps",
  Knee: "genou",
  Ankle: "cheville",
  Foot: "pied",
  Hand: "main",
  Wrist: "poignet",
  Back: "dos",
  Hip: "hanche",
  Groin: "aine",
  Concussion: "commotion",
  Head: "tête",
  Illness: "maladie",
  Leg: "jambe",
  Elbow: "coude",
  Neck: "cou",
  Undisclosed: "non divulguée",
  Suspension: "suspension",
  "Contract Dispute": "différend contractuel",
  Personal: "raisons personnelles",
};
const dateFr = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("fr-CA", { day: "numeric", month: "long", year: "numeric" });
const NBSP = " ";
const fmt1 = (x: number) => x.toFixed(1).replace(".", ",");
const fmt0 = (x: number) => Math.round(x).toLocaleString("fr-CA");
const ord = (n: number) => (n === 1 ? "1er" : `${n}e`);
const season = (y: number) => `${y}-${String((y + 1) % 100).padStart(2, "0")}`;

function Card({ title, icon, children, accent = "text-cyan-300", aside }: { title: string; icon: ReactNode; children: ReactNode; accent?: string; aside?: ReactNode }) {
  return (
    <section className="min-w-0 rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900/80 to-slate-950/80 p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className={`flex items-center gap-2 text-base font-semibold ${accent}`}>
          {icon}
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl bg-white/[0.03] px-3 py-2 ring-1 ring-white/5" title={hint}>
      <div className="text-[11px] uppercase tracking-wider text-slate-400">{label}</div>
      <div className="text-lg font-semibold tabular-nums text-white">{value}</div>
    </div>
  );
}

function ScoreBar({ score }: { score: number }) {
  return (
    <span className="inline-flex items-center gap-2" title={`Meilleur que ${score} % des joueurs possédés de la ligue`}>
      <span className="h-2 w-24 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
        <span className="block h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-400" style={{ width: `${score}%` }} />
      </span>
      <span className="font-semibold tabular-nums text-white">{score}</span>
    </span>
  );
}

/** Expected value per season (six bars). */
function ValueBars({ eG, label }: { eG: number[]; label: string }) {
  const max = Math.max(1, ...eG);
  return (
    <figure className="mt-3">
      <figcaption className="mb-1 text-xs text-slate-400">{label}</figcaption>
      <div className="flex h-20 items-end gap-1.5" role="img" aria-label={`${label} : ${eG.map((x, t) => `${season(SEASON0 + t)} ${Math.round(x)}`).join(", ")}`}>
        {eG.map((x, t) => (
          <div key={t} className="flex flex-1 flex-col items-center gap-1">
            <div className="w-full rounded-t bg-cyan-500/70" style={{ height: `${Math.max(2, (Math.max(0, x) / max) * 64)}px` }} />
            <span className="text-[10px] tabular-nums text-slate-400">{String((SEASON0 + t + 1) % 100).padStart(2, "0")}</span>
          </div>
        ))}
      </div>
    </figure>
  );
}

function OwnerLine({ part, league }: { part: FantraxCardPart; league: LeagueInfo }) {
  if (!part.own) return <p className="text-sm text-emerald-200">Disponible (aucune équipe)</p>;
  const mine = part.own === league.myTeamId;
  return (
    <p className="text-sm text-slate-200">
      <span className={mine ? "font-semibold text-cyan-200" : "font-semibold text-white"}>{part.ownName ?? "Équipe inconnue"}</span>
      {mine ? " (mon équipe)" : ""}
      {part.st ? <span className="text-slate-400"> · {STATUS_FR[part.st] ?? part.st}</span> : null}
    </p>
  );
}

function FantraxLeagueCard({ part, league }: { part: FantraxCardPart; league: LeagueInfo }) {
  return (
    <Card
      title={league.name}
      icon={<Trophy className="h-4 w-4" aria-hidden="true" />}
      aside={
        <span className="flex gap-2 text-xs">
          <Link className="text-cyan-300 hover:underline" href={leaguePlayerPath(league.slug, part.fx)}>
            Dans Joueurs
          </Link>
          <Link className="text-cyan-300 hover:underline" href={leagueTabPath(league.slug, "actifs")}>
            Actifs
          </Link>
        </span>
      }
    >
      <OwnerLine part={part} league={league} />
      {part.dv && part.sc && part.rk ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Stat label="Score d’actif" value={<ScoreBar score={part.sc.B} />} hint="Horizon équilibré; percentile parmi les joueurs possédés" />
          <Stat label="Valeur dynastie" value={`${fmt0(part.dv.B)} · ${ord(part.rk.B)}`} hint="Horizon équilibré, rang dans la ligue" />
          <Stat label="Gagner maintenant" value={`${fmt0(part.dv.W)} · ${ord(part.rk.W)}`} />
          <Stat label="Long terme" value={`${fmt0(part.dv.L)} · ${ord(part.rk.L)}`} />
        </div>
      ) : (
        <p className="mt-2 text-sm text-slate-400">Pas de valeur dynastie dans cette ligue.</p>
      )}
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        {part.ph ? <span className="rounded-full bg-white/5 px-2 py-0.5 text-slate-200 ring-1 ring-white/10">{PHASE_FR[part.ph] ?? part.ph}</span> : null}
        {part.kp ? (
          <span className="rounded-full bg-white/5 px-2 py-0.5 text-slate-200 ring-1 ring-white/10">
            {KEEPER_FR[part.kp.st] ?? part.kp.st}
            {part.kp.p != null ? ` (${Math.round(part.kp.p * 100)}${NBSP}%)` : ""}
          </span>
        ) : null}
      </div>
      {part.ct ? (
        <div className="mt-3 rounded-xl bg-amber-500/5 p-3 ring-1 ring-amber-500/20">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span className="font-semibold text-amber-100">
              {part.ct.f ? "Contrat de ligue confirmé" : "Contrat de ligue conseillé"} : {part.ct.y}
              {NBSP}an{part.ct.y > 1 ? "s" : ""} à {fmtMoney(part.ct.b)}
            </span>
            <Link className="text-xs text-amber-200 hover:underline" href={leagueTabPath(league.slug, "plafond")}>
              Plafond
            </Link>
          </div>
          <div className="mt-2 grid grid-cols-7 gap-1 text-center text-[11px] tabular-nums">
            {part.ct.sal.map((s, t) => (
              <div key={t} className={`rounded px-0.5 py-1 ${s === 0 ? "text-slate-400" : t >= part.ct!.start + part.ct!.y ? "bg-violet-500/10 text-violet-200" : "bg-white/5 text-slate-100"}`}>
                <div className="text-slate-400">{String((SEASON0 + t + 1) % 100).padStart(2, "0")}</div>
                {s === 0 ? "—" : fmt1(s)}
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-400">
            {part.ct.e > 0 && part.ct.eb != null ? `Puis prolongation de ${part.ct.e}${NBSP}an${part.ct.e > 1 ? "s" : ""} à ~${fmtMoney(part.ct.eb)} (en violet), ` : "Puis "}
            agent libre. Salaires en M$.
          </p>
        </div>
      ) : null}
      {part.eG?.length ? <ValueBars eG={part.eG} label="Valeur attendue par saison (modèle dynastie)" /> : null}
    </Card>
  );
}

function LtlCard({ part, league }: { part: LtlCardPart; league: LeagueInfo; nhl: number }) {
  return (
    <Card
      title={league.name}
      icon={<Trophy className="h-4 w-4" aria-hidden="true" />}
      accent="text-violet-300"
      aside={
        <Link className="text-xs text-cyan-300 hover:underline" href={leagueTabPath(league.slug, "joueurs")}>
          Joueurs
        </Link>
      }
    >
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Rang" value={part.rank ? ord(part.rank) : "—"} hint="Rang au tableau (valeur au-dessus du remplacement, catégories de la ligue)" />
        <Stat label="VOR" value={part.vor == null ? "—" : fmt1(part.vor)} />
      </div>
      {part.posRank ? (
        <p className="mt-2 text-xs text-slate-300">
          Par position : {Object.entries(part.posRank).map(([p, r]) => `${p} ${ord(r)}`).join(" · ")}
        </p>
      ) : null}
      {part.z ? (
        <div className="mt-3 grid grid-cols-6 gap-1 text-center text-[11px] tabular-nums">
          {["B", "A", "AN", "Tirs", "MÉ", "TB"].map((c, i) => {
            const z = part.z![i] ?? 0;
            return (
              <div key={c} className={`rounded px-0.5 py-1 ${z >= 1 ? "bg-emerald-500/15 text-emerald-100" : z <= -1 ? "bg-rose-500/10 text-rose-200" : "bg-white/5 text-slate-200"}`} title="Écart à la moyenne (z)">
                <div className="text-slate-400">{c}</div>
                {z > 0 ? "+" : ""}
                {fmt1(z)}
              </div>
            );
          })}
        </div>
      ) : null}
      {part.adjusted ? <p className="mt-2 text-xs text-amber-200">Rang ajusté à la main : {part.adjusted}</p> : null}
    </Card>
  );
}

const DAY = 24 * 3600 * 1000;
const dayCount = (n: number) => `${n}${NBSP}jour${n > 1 ? "s" : ""}`;
const gameCount = (n: number) => `${n}${NBSP}match${n > 1 ? "s" : ""}`;

/** Injured or suspended now: status, type, since when, estimated return and what is left (days, games). */
function AbsenceBanner({ inj, nowMs }: { inj: NonNullable<PlayerCardData["injNow"]>; nowMs: number }) {
  const suspended = inj.st === "Suspension";
  const ret = inj.ret ? Date.parse(`${inj.ret}T12:00:00Z`) : NaN;
  const since = inj.since ? Date.parse(`${inj.since}T12:00:00Z`) : NaN;
  const daysLeft = Number.isFinite(ret) ? Math.max(0, Math.ceil((ret - nowMs) / DAY)) : null;
  const daysOut = Number.isFinite(since) ? Math.max(0, Math.floor((nowMs - since) / DAY)) : null;
  const total = Number.isFinite(ret) && Number.isFinite(since) ? Math.max(1, Math.round((ret - since) / DAY)) : null;
  const type = inj.note && inj.note !== inj.st ? (INJ_TYPE_FR[inj.note] ?? inj.note) : null;
  const tone = suspended ? "border-amber-400/40 bg-amber-500/10 text-amber-50" : "border-rose-400/40 bg-rose-500/10 text-rose-50";
  return (
    <section aria-label={suspended ? "Suspension" : "Blessure"} className={`rounded-2xl border p-4 sm:p-5 ${tone}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Activity className="h-5 w-5" aria-hidden="true" />
          {suspended ? "Suspendu" : (INJ_FR[inj.st] ?? inj.st)}
          {type && !suspended ? <span className="font-normal">· {type}</span> : null}
        </h2>
        {inj.since ? <span className="text-xs opacity-80">signalé le {dateFr(inj.since)}{daysOut ? ` (il y a ${dayCount(daysOut)})` : ""}</span> : null}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-xl bg-black/20 px-3 py-2">
          <div className="text-[11px] uppercase tracking-wider opacity-75">Retour estimé</div>
          <div className="font-semibold">{inj.ret ? dateFr(inj.ret) : "non précisé"}</div>
        </div>
        <div className="rounded-xl bg-black/20 px-3 py-2">
          <div className="text-[11px] uppercase tracking-wider opacity-75">Encore</div>
          <div className="font-semibold">{daysLeft == null ? "inconnu" : daysLeft === 0 ? "retour imminent" : dayCount(daysLeft)}</div>
        </div>
        <div className="rounded-xl bg-black/20 px-3 py-2">
          <div className="text-[11px] uppercase tracking-wider opacity-75">Matchs manqués d’ici là</div>
          <div className="font-semibold">{gameCount(inj.out)}{inj.ret ? "" : " (estimation)"}</div>
        </div>
        <div className="rounded-xl bg-black/20 px-3 py-2">
          <div className="text-[11px] uppercase tracking-wider opacity-75">Durée totale</div>
          <div className="font-semibold">{total ? `≈ ${total >= 14 ? `${Math.round(total / 7)}${NBSP}semaines` : dayCount(total)}` : "inconnue"}</div>
        </div>
      </div>
      <p className="mt-2 text-xs opacity-80">
        Source : rapport public des blessures d’ESPN, relu chaque jour. Les matchs manqués sont retirés de sa projection{inj.ret ? "" : " (sans date, une absence typique pour ce statut)"}.
      </p>
    </section>
  );
}

/**
 * A player's card (/joueur?id=<NHL id>, or ?fx=<Fantrax id>&ligue=<slug>):
 * identity, NHL contract, this season's projection, career, Snake, and his
 * place in each of the user's leagues — all from one data shard
 * (scripts/build-player-cards.ts).
 */
export function PlayerCardView({ leagues }: { leagues: LeagueInfo[] }) {
  const params = useSearchParams();
  const idParam = params.get("id");
  const fx = params.get("fx");
  const ligue = params.get("ligue");
  const [card, setCard] = useState<PlayerCardData | null>(null);
  const [fxOnly, setFxOnly] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [projAt, setProjAt] = useState<string | null>(null);
  const [nowMs] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      let nhl = idParam && /^\d{6,8}$/.test(idParam) ? Number(idParam) : null;
      if (!nhl && fx && ligue && /^[a-z0-9-]{2,40}$/.test(ligue)) {
        const key = ligue === "captains-dynasty" ? "captains" : ligue;
        const idx = (await fetch(withBasePath(`/joueurs/fx-${key}.json`)).then((r) => (r.ok ? r.json() : {}))) as Record<string, [number, string]>;
        const hit = idx[fx];
        if (hit && hit[0]) nhl = hit[0];
        else if (hit) {
          if (!cancelled) {
            setFxOnly(hit[1]);
            setState("missing");
          }
          return;
        }
      }
      if (!nhl) {
        if (!cancelled) setState("missing");
        return;
      }
      const file = (await fetch(withBasePath(`/${cardShardFile(nhl)}`)).then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })) as CardFile;
      if (cancelled) return;
      const c = file.players[String(nhl)] ?? null;
      setCard(c);
      setProjAt(file.projectionsAt);
      setState(c ? "ready" : "missing");
    };
    load().catch(() => !cancelled && setState("error"));
    return () => {
      cancelled = true;
    };
  }, [idParam, fx, ligue]);

  useEffect(() => {
    if (card) document.title = `${card.n} — Fiche de joueur | Fantasy Hockey VOR`;
  }, [card]);

  if (state === "loading") return <h1 className="text-2xl font-bold text-white">Chargement de la fiche…</h1>;
  if (state === "error") return <h1 className="text-2xl font-bold text-white">La fiche n’a pas pu être lue. Actualisez la page.</h1>;
  if (state === "missing" || !card) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-white">{fxOnly ?? "Joueur introuvable"}</h1>
        <p className="mt-2 text-sm text-slate-400">
          {fxOnly ? "Ce joueur n’a pas d’identifiant LNH connu : sa fiche se limite à la ligue." : "Aucune fiche pour ce joueur."}
          {fx && ligue ? (
            <>
              {" "}
              <Link className="text-cyan-300 hover:underline" href={leaguePlayerPath(ligue, fx)}>
                Le voir dans la ligue
              </Link>
            </>
          ) : null}
        </p>
      </div>
    );
  }

  const age = ageOn(card.bd, nowMs);
  const lastTeam = (card.hist.at(-1)?.[1] as string | undefined) ?? card.t;
  const byKind = (slug: string) => leagues.find((l) => l.slug === slug);
  const cap = card.lg?.captains;
  const slap = card.lg?.slapshot;
  const ltl = card.lg?.ltl;
  const proj = card.proj;

  return (
    <article className="grid gap-6">
      {/* ---- identity */}
      <header className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-cyan-950/40 via-slate-900 to-slate-950 p-5 sm:p-7">
        <div className="pointer-events-none absolute -right-10 -top-10 text-[10rem] font-black leading-none text-white/[0.03]" aria-hidden="true">
          {card.num ?? ""}
        </div>
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://assets.nhle.com/mugs/nhl/20252026/${lastTeam}/${card.id}.png`}
            alt=""
            width={120}
            height={120}
            className="h-28 w-28 shrink-0 rounded-2xl bg-white/5 object-cover ring-1 ring-white/10"
            onError={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = "hidden")}
          />
          <div className="min-w-0">
            <p className="text-sm text-cyan-200">
              {card.t || "Sans équipe"}
              {card.num != null ? ` · #${card.num}` : ""} · {card.pos.map((p) => POS_FR[p] ?? p).join(" / ")}
            </p>
            <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">{card.n}</h1>
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-300">
              {age != null ? <span>{Math.floor(age)} ans</span> : null}
              {card.h ? <span>{Math.round(card.h * 2.54)} cm</span> : null}
              {card.w ? <span>{Math.round(card.w * 0.4536)} kg</span> : null}
              {card.sh ? <span>{card.g ? "Attrape" : "Lance"} de la {card.sh === "L" ? "gauche" : "droite"}</span> : null}
              {card.from ? <span>Né à {card.from}</span> : null}
            </p>
            <p className="mt-1 text-sm text-slate-400">
              {card.dr ? `Repêché en ${card.dr[0]}${card.dr[1] ? `, ${card.dr[1]}e ronde` : ""} (${ord(card.dr[2])} au total) par ${card.dr[3]}` : "Jamais repêché"}
              {card.k ? ` · Contrat LNH : ${fmtMoney(card.k.cap)}${card.k.yrs != null ? `, ${card.k.yrs} an${card.k.yrs > 1 ? "s" : ""}` : ""}${card.k.st ? ` (${card.k.st === "RFA" ? "JAC" : "JAS"})` : ""}` : ""}
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {card.inj?.tr ? (
                <span className={`rounded-full px-2 py-0.5 ring-1 ${card.inj.tr === "healthy" ? "bg-emerald-500/10 text-emerald-200 ring-emerald-500/30" : "bg-amber-500/10 text-amber-200 ring-amber-500/30"}`}>
                  <ShieldCheck className="mr-1 inline h-3 w-3" aria-hidden="true" />
                  {card.inj.tr === "healthy" ? "Durable" : card.inj.tr === "injury_prone" ? "Souvent blessé" : "Durabilité moyenne"}
                </span>
              ) : null}
              {card.sn ? (
                <Link href={snakePath(card.sn[0])} className={`rounded-full px-2 py-0.5 ring-1 hover:underline ${VERDICT_TONE[card.sn[1]] ?? "bg-white/5 text-slate-200 ring-white/10"}`}>
                  <Mic className="mr-1 inline h-3 w-3" aria-hidden="true" />
                  Snake : {card.sn[1]}
                  {card.sn[2] && card.sn[2] !== "inconnue" ? ` (${card.sn[2]})` : ""}
                </Link>
              ) : null}
              <a
                href={`https://www.nhl.com/fr/player/${card.id}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-full bg-white/5 px-2 py-0.5 text-slate-300 ring-1 ring-white/10 hover:underline"
              >
                NHL.com <ExternalLink className="inline h-3 w-3" aria-hidden="true" />
                <span className="sr-only"> (nouvel onglet)</span>
              </a>
            </div>
          </div>
        </div>
      </header>

      {/* ---- injury / suspension */}
      {card.injNow ? <AbsenceBanner inj={card.injNow} nowMs={nowMs} /> : null}

      {/* ---- leagues */}
      <section aria-label="Dans vos ligues" className="grid gap-4 lg:grid-cols-3">
        {cap && byKind("captains-dynasty") ? <FantraxLeagueCard part={cap} league={byKind("captains-dynasty")!} /> : null}
        {slap && byKind("slapshot") ? <FantraxLeagueCard part={slap} league={byKind("slapshot")!} /> : null}
        {ltl && byKind("light-the-lamp") ? <LtlCard part={ltl} league={byKind("light-the-lamp")!} nhl={card.id} /> : null}
        {!cap && !slap && !ltl ? <p className="text-sm text-slate-400">Ce joueur n’apparaît dans aucune de vos ligues.</p> : null}
      </section>

      {/* ---- this season so far */}
      {card.cur ? (
        <Card title={`Saison ${season(SEASON0)} jusqu’ici`} icon={<Activity className="h-4 w-4" aria-hidden="true" />} accent="text-sky-300">
          {card.g ? (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              <Stat label="PJ" value={card.cur.gp} />
              <Stat label="Victoires" value={card.cur.s.wins ?? 0} />
              <Stat label="Arrêts" value={card.cur.s.saves ?? 0} />
              <Stat
                label="% arrêts"
                value={card.cur.s.shotsAgainst ? ((card.cur.s.saves ?? 0) / card.cur.s.shotsAgainst).toFixed(3).replace("0.", ",") : "—"}
              />
              <Stat label="Blanchissages" value={card.cur.s.shutouts ?? 0} />
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-8">
              <Stat label="PJ" value={card.cur.gp} />
              <Stat label="Buts" value={card.cur.s.goals ?? 0} />
              <Stat label="Passes" value={card.cur.s.assists ?? 0} />
              <Stat label="Points" value={(card.cur.s.goals ?? 0) + (card.cur.s.assists ?? 0)} />
              <Stat label="Pts AN" value={card.cur.s.powerplayPoints ?? 0} />
              <Stat label="Tirs" value={card.cur.s.shots ?? 0} />
              <Stat label="Mises en échec" value={card.cur.s.hits ?? 0} />
              <Stat label="Tirs bloqués" value={card.cur.s.blocks ?? 0} />
            </div>
          )}
        </Card>
      ) : null}

      {/* ---- projection */}
      {proj ? (
        <Card
          title={`Projection ${season(SEASON0)} (réel + reste de la saison)`}
          icon={<LineChart className="h-4 w-4" aria-hidden="true" />}
          accent="text-emerald-300"
          aside={projAt ? <span className="text-xs text-slate-400">mise à jour le {new Date(projAt).toLocaleDateString("fr-CA")}</span> : null}
        >
          {"g" in proj ? (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
              <Stat label="PJ" value={proj.gp} />
              <Stat label="Buts" value={fmt0(proj.g)} />
              <Stat label="Passes" value={fmt0(proj.a)} />
              <Stat label="Points" value={fmt0(proj.g + proj.a)} />
              <Stat label="Pts AN" value={fmt0(proj.ppp)} />
              <Stat label="Tirs" value={fmt0(proj.sog)} />
              <Stat label="Mises en échec" value={fmt0(proj.hit)} />
              <Stat label="Tirs bloqués" value={fmt0(proj.blk)} />
              <Stat label="Pts/match" value={proj.gp ? ((proj.g + proj.a) / proj.gp).toFixed(2).replace(".", ",") : "—"} />
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              <Stat label="PJ" value={proj.gp} />
              <Stat label="Victoires" value={fmt0(proj.w)} />
              <Stat label="% arrêts" value={proj.sv.toFixed(3).replace("0.", ",")} />
              <Stat label="Moyenne" value={proj.gaa.toFixed(2).replace(".", ",")} />
              <Stat label="Blanchissages" value={fmt1(proj.so)} />
            </div>
          )}
        </Card>
      ) : null}

      {/* ---- career */}
      {card.hist.length ? (
        <Card title="Carrière récente dans la LNH" icon={<CalendarRange className="h-4 w-4" aria-hidden="true" />} accent="text-slate-200">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-sm tabular-nums">
              <caption className="sr-only">Statistiques par saison</caption>
              <thead>
                <tr className="text-xs text-slate-400">
                  {(card.g ? ["Saison", "Équipe", "PJ", "V", "% arrêts", "Moy.", "BL"] : ["Saison", "Équipe", "PJ", "B", "A", "Pts", "AN", "Tirs", "MÉ", "TB", "TG/m"]).map((h) => (
                    <th key={h} scope="col" className="py-1 pr-2 text-right font-medium first:text-left [&:nth-child(2)]:text-left">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...card.hist].reverse().map((s) => {
                  const cells = card.g
                    ? [s[0], s[1], s[2], s[3], (s[4] as number).toFixed(3).replace("0.", ","), (s[5] as number).toFixed(2).replace(".", ","), s[6]]
                    : [s[0], s[1], s[2], s[3], s[4], (s[3] as number) + (s[4] as number), s[5], s[6], s[7], s[8], fmt1(s[9] as number)];
                  return (
                    <tr key={`${s[0]}-${s[1]}`} className="border-t border-white/5">
                      {cells.map((c, i) => (
                        <td key={i} className={`py-1 pr-2 ${i < 2 ? "text-left text-slate-300" : "text-right text-slate-100"}`}>
                          {c}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <Card title="Carrière" icon={<Activity className="h-4 w-4" aria-hidden="true" />} accent="text-slate-200">
          <p className="text-sm text-slate-400">Pas encore de match dans la LNH.</p>
        </Card>
      )}

      <p className="flex items-center gap-2 text-xs text-slate-400">
        <Briefcase className="h-3.5 w-3.5" aria-hidden="true" />
        Propriétaires et valeurs à la dernière synchronisation des ligues (deux fois par jour). Valeurs dynastie : horizon équilibré.
      </p>
    </article>
  );
}

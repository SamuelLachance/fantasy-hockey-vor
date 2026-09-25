import Link from "next/link";
import { Fragment } from "react";
import { stanceLabel } from "@/lib/snake/copy";
import { SNAKE_STANCES } from "@/lib/snake/types";
import { SNAKE_PATH } from "@/lib/snake/url";
import { SnakeMiniChip } from "./SnakeBoardChip";

/**
 * What the compact Snake chips of a player list mean (S++ … S−−, « ? »),
 * with the one-line reminder that they summarize his public podcasts
 * unofficially. Shown with the Yahoo draft board, whose rows carry the
 * chips without room for words.
 */
export function SnakeChipLegend({ className = "" }: { className?: string }) {
  return (
    <p className={`text-xs leading-relaxed text-slate-400 ${className}`.trim()}>
      <span className="font-medium text-slate-300">Pastilles Snake :</span>{" "}
      {SNAKE_STANCES.map((s, i) => (
        // The separator stays outside the no-wrap span: lines may break between entries.
        <Fragment key={s}>
          <span className="whitespace-nowrap">
            <SnakeMiniChip verdict={s} trend="inconnue" probable={false} decorative /> {stanceLabel(s).toLowerCase()}
          </span>
          {i < SNAKE_STANCES.length - 1 ? ", " : " "}
        </Fragment>
      ))}
      (verdict de Simon « Snake » Boisvert sur le joueur); « ? » = attribution probable, à vérifier dans la vidéo.
      Résumés non officiels, générés automatiquement à partir de ses balados publics.{" "}
      <Link
        href={`${SNAKE_PATH}#sources`}
        prefetch={false}
        className="rounded-sm text-cyan-400/90 underline underline-offset-2 hover:text-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
      >
        Méthode et sources
      </Link>
    </p>
  );
}

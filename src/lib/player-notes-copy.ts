/** Accessible label while player notes skeleton is shown. */
export function playerNotesLoadingLabel(): string {
  return "Loading player notes";
}

/** Accessible label while the expanded player panel chunk is loading. */
export function playerPanelLoadingLabel(): string {
  return "Loading player details";
}

/** Error line when player-details.json failed. */
export function playerNotesUnavailableCopy(): string {
  return "Player notes unavailable.";
}

/** Settled expand with no reasoning / profile summary to show. */
export function playerNotesEmptyCopy(): string {
  return "No projection notes for this player.";
}

/** True when either notes field has non-whitespace content. */
export function playerNotesHasContent(
  details:
    | { reasoning?: string | null; profileSummary?: string | null }
    | null
    | undefined,
): boolean {
  if (!details) return false;
  return (
    !!(details.reasoning?.trim() || details.profileSummary?.trim())
  );
}

/** Retry control label while a fetch is in flight. */
export function playerNotesRetryLabel(retrying: boolean): string {
  return retrying ? "Retrying…" : "Retry";
}

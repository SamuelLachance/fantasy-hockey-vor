/** Accessible label while player notes skeleton is shown. */
export function playerNotesLoadingLabel(): string {
  return "Loading player notes";
}

/** Error line when player-details.json failed. */
export function playerNotesUnavailableCopy(): string {
  return "Player notes unavailable.";
}

/** Retry control label while a fetch is in flight. */
export function playerNotesRetryLabel(retrying: boolean): string {
  return retrying ? "Retrying…" : "Retry";
}

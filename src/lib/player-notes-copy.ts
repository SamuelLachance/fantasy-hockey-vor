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

/** Retry control label while a fetch is in flight. */
export function playerNotesRetryLabel(retrying: boolean): string {
  return retrying ? "Retrying…" : "Retry";
}

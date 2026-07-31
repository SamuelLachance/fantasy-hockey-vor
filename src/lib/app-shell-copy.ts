/** Route loading status. */
export function loadingRankingsCopy(): string {
  return "Loading rankings…";
}

/** Client error boundary title. */
export function errorBoundaryTitle(): string {
  return "Something went wrong";
}

/** Client error boundary body. */
export function errorBoundaryBody(): string {
  return (
    "The rankings UI hit an unexpected error. Your data files are usually " +
    "fine — try again, or hard-refresh."
  );
}

export function errorTryAgainCopy(): string {
  return "Try again";
}

export function errorBackToRankingsCopy(): string {
  return "Back to rankings";
}

export function notFoundTitle(): string {
  return "Page not found";
}

export function notFoundBody(): string {
  return "That route is not part of the rankings app. Head back to the full board.";
}

export function globalErrorTitle(): string {
  return "App error";
}

export function globalErrorBody(): string {
  return "A root-level failure occurred. Retry to remount the application.";
}

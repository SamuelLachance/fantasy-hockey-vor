/** Client error boundary title. */
export function errorBoundaryTitle(): string {
  return "Une erreur est survenue";
}

/** Client error boundary body. */
export function errorBoundaryBody(): string {
  return "Cette page a rencontré une erreur inattendue. Vos données sont intactes : réessayez, ou rechargez la page.";
}

export function errorTryAgainCopy(): string {
  return "Réessayer";
}

/** Link back to the home page (« Mes ligues »). */
export function errorBackHomeCopy(): string {
  return "Retour à l’accueil";
}

/** Error reference shown under the message (Next's digest). */
export function errorReferenceCopy(digest: string): string {
  return `Référence : ${digest}`;
}

export function notFoundTitle(): string {
  return "Page introuvable";
}

export function notFoundBody(): string {
  return "Cette adresse n’existe pas ou plus.";
}

export function globalErrorTitle(): string {
  return "Erreur de l’application";
}

export function globalErrorBody(): string {
  return "Une erreur a empêché l’affichage du site. Réessayez pour le relancer.";
}

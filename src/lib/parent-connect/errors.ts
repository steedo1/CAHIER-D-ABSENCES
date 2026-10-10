export function parentConnectOperationError(message: string) {
  const errors: Record<string, string> = {
    PARENT_CONNECT_NO_CREDITS: "Aucun crédit prépayé disponible. Contactez Nexa Digital avant d’encaisser.",
    PARENT_CONNECT_ALREADY_COVERED: "Cet enfant est déjà couvert pour cette année scolaire. Aucun nouveau paiement n’est nécessaire.",
    PARENT_CONNECT_YEAR_REQUIRED: "Vérifiez l’année scolaire courante et sa date de fin dans les paramètres de l’établissement.",
    PARENT_CONNECT_YEAR_CHANGED: "L’année scolaire a changé. Actualisez la page avant de continuer.",
    PARENT_CONNECT_ACTIVATIONS_PAUSED: "Les nouvelles activations sont suspendues par le super admin.",
    PARENT_CONNECT_ROSTER_CHANGED: "La liste des élèves a changé. Actualisez avant l’activation collective.",
    PARENT_CONNECT_ALREADY_CONFIRMED: "Ce versement a déjà été confirmé et crédité.",
    PARENT_CONNECT_STALE_SUBSCRIPTION: "L’abonnement a changé. Actualisez la liste avant d’encaisser.",
    PARENT_CONNECT_OPERATION_CONFLICT: "Cette opération a déjà été utilisée. Actualisez la page.",
    PARENT_CONNECT_STUDENT_NOT_ENROLLED: "Cet élève n’est pas inscrit dans une classe de l’année scolaire actuelle.",
    PARENT_CONNECT_STUDENT_NOT_FOUND: "Élève introuvable dans cet établissement.",
    PARENT_CONNECT_MATRICULE_REQUIRED: "Renseignez le matricule de l’élève avant d’activer Parent Connect.",
    PARENT_CONNECT_FORBIDDEN: "Vous n’êtes pas autorisé à enregistrer cette opération.",
    PARENT_CONNECT_INVALID_GRANT: "Vérifiez le nombre de crédits et le versement reçu (1 500 FCFA par crédit).",
  };
  return errors[message] || "Parent Connect n’est pas disponible. Vérifiez son installation et les informations saisies.";
}

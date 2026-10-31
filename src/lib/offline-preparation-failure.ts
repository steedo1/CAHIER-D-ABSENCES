function messageOf(cause: unknown) {
  const error = cause as { name?: unknown; message?: unknown } | null;
  return String(error?.message || cause || "");
}
export function retryableOfflinePreparationFailure(cause: unknown) {
  const status = Number((cause as { status?: unknown } | null)?.status);
  if (status === 401 || status === 403) return false;
  if (status === 408 || status === 429 || status >= 500) return true;
  return /(?:timeout|délai|serveur[^.]*répon|failed to fetch|fetch failed|network|réseau|indisponible|aborted|http (?:408|429|5\d\d)|schedule_changed_during_(?:read|prepare))/i.test(messageOf(cause));
}
export function offlinePreparationFailureMessage(cause: unknown) {
  const message = messageOf(cause);
  const name = String((cause as { name?: unknown } | null)?.name || "");
  if (message === "teacher_phone_account_conflict")
    return "Ce téléphone est connecté à un ancien compte sans cours. Reconnectez-vous avec votre numéro complet à 10 chiffres, en conservant le zéro initial. Les actions locales restent conservées sur cet appareil.";
  if (/class_weekly_(?:schedule_incomplete|subject_missing)/.test(message))
    return "Le planning de la classe est incomplet. Vérifiez les créneaux et les disciplines dans l’établissement, puis réessayez.";
  if (message === "teacher_roster_incomplete")
    return "La liste des élèves reçue est incomplète. Relancez la préparation avant de travailler hors connexion.";
  if (message === "institution_schedule_not_configured")
    return "Emplois du temps en attente : aucun créneau d’appel n’a encore été configuré par l’établissement. Les appels automatiques seront disponibles après l’enregistrement des horaires officiels.";
  if (/QuotaExceededError|quota|storage.*full|disk.*full/i.test(name + " " + message))
    return "L’espace disponible sur cet appareil est insuffisant. Libérez de l’espace sans effacer les données de Mon Cahier, puis réessayez.";
  if (/unauthorized|http 401/i.test(message))
    return "La connexion au compte a expiré. Reconnectez le même compte, puis relancez la préparation. Les appels locaux sont conservés.";
  if (/forbidden|http 403|device_mismatch|class_mismatch/i.test(message))
    return "Ce compte ne peut pas préparer cette classe. Vérifiez le compte de classe connecté.";
  if (/schedule_changed_during_|attendance_schedule_identity_or_revision_changed/i.test(message))
    return "Le planning a changé pendant la préparation. Relancez la préparation pour utiliser les nouveaux horaires.";
  if (retryableOfflinePreparationFailure(cause))
    return "Le serveur n’a pas répondu correctement. Gardez Internet activé, puis réessayez.";
  if (/offline.*schema|format.*hors ligne/i.test(message))
    return "La version de l’application doit être actualisée. Rouvrez Mon Cahier avec Internet, puis réessayez.";
  // Les messages métier déjà traduits expliquent notamment une classe absente,
  // un shell incomplet ou un refus de stockage. Ne pas exposer les codes bruts.
  if (/^(?:La |Le |Les |L’application |L’appareil |Ce |Cet |Cette |Aucune |Aucun |Reconnectez |Actualisez )/.test(message))
    return message;
  return "La préparation n’a pas pu être terminée. Vérifiez la connexion, puis réessayez.";
}

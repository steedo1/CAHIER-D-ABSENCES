import type { TeacherOfflinePendingSummary } from "@/lib/teacher-offline-pending";

export type TeacherConnectivityUiState =
  | "checking"
  | "connected"
  | "unavailable"
  | "unconfigured";

export type TeacherStatusTone = "emerald" | "amber" | "rose" | "slate";

export type TeacherStatusBadge = {
  label: string;
  tone: TeacherStatusTone;
  description: string;
};

export type TeacherOfflineStatusView = {
  cloud: TeacherStatusBadge;
  relay: TeacherStatusBadge;
  data: TeacherStatusBadge;
  sync: {
    enabled: boolean;
    label: string;
    title: string;
  };
};

export type TeacherOfflineStatusInput = {
  cloud: Exclude<TeacherConnectivityUiState, "unconfigured">;
  relay: TeacherConnectivityUiState;
  pending: TeacherOfflinePendingSummary;
  syncing: boolean;
};

function cloudBadge(
  state: TeacherOfflineStatusInput["cloud"],
): TeacherStatusBadge {
  if (state === "connected") {
    return {
      label: "Cloud : disponible",
      tone: "emerald",
      description: "La plateforme en ligne répond normalement.",
    };
  }
  if (state === "unavailable") {
    return {
      label: "Cloud : indisponible",
      tone: "amber",
      description:
        "Internet ou le Cloud est indisponible. Le relais local peut continuer à protéger les appels.",
    };
  }
  return {
    label: "Cloud : vérification",
    tone: "slate",
    description: "La disponibilité du Cloud est en cours de vérification.",
  };
}

function relayBadge(state: TeacherConnectivityUiState): TeacherStatusBadge {
  if (state === "connected") {
    return {
      label: "Relais : disponible",
      tone: "emerald",
      description:
        "Le téléphone peut sécuriser les opérations sur le PC de l’établissement, même sans Internet.",
    };
  }
  if (state === "unavailable") {
    return {
      label: "Relais : indisponible",
      tone: "amber",
      description:
        "Le relais local ne répond pas actuellement. Les données restent conservées sur le téléphone.",
    };
  }
  if (state === "unconfigured") {
    return {
      label: "Relais : non configuré",
      tone: "slate",
      description:
        "Aucun accès au relais local n’est configuré pour ce compte enseignant.",
    };
  }
  return {
    label: "Relais : à vérifier",
    tone: "slate",
    description:
      "Le relais sera vérifié lors du prochain appel ou de la prochaine synchronisation.",
  };
}

function dataBadge(
  pending: TeacherOfflinePendingSummary,
  syncing: boolean,
): TeacherStatusBadge {
  if (syncing) {
    return {
      label: "Données : synchronisation…",
      tone: "amber",
      description: "Le relais local est essayé avant le Cloud.",
    };
  }
  if (pending.blocked > 0) {
    return {
      label: `Données : ${pending.blocked} à vérifier`,
      tone: "rose",
      description:
        "Les données sont conservées, mais une règle métier ou un conflit nécessite une vérification.",
    };
  }
  if (pending.delivery_unknown > 0) {
    return {
      label: `Données : ${pending.delivery_unknown} confirmation Cloud`,
      tone: "amber",
      description:
        "Le Cloud est interrogé avant tout renvoi afin d’éviter les doublons.",
    };
  }
  if (pending.device_pending > 0) {
    return {
      label: `Données : ${pending.device_pending} sur ce téléphone`,
      tone: "amber",
      description:
        "Ces opérations sont sauvegardées sur le téléphone et seront envoyées au relais ou au Cloud dès que possible.",
    };
  }
  if (pending.relay_secured > 0) {
    return {
      label: `Données : ${pending.relay_secured} sur le relais`,
      tone: "emerald",
      description:
        "Ces opérations sont déjà protégées dans l’établissement et attendent leur confirmation Cloud.",
    };
  }
  return {
    label: "Données : synchronisées",
    tone: "emerald",
    description: "Aucune opération n’attend sur ce téléphone ou sur le relais.",
  };
}

export function buildTeacherOfflineStatus(
  input: TeacherOfflineStatusInput,
): TeacherOfflineStatusView {
  const cloud = cloudBadge(input.cloud);
  const relay = relayBadge(input.relay);
  const data = dataBadge(input.pending, input.syncing);
  const hasPending = input.pending.total > 0;
  const enabled = hasPending && !input.syncing;

  let title = "Aucune opération en attente.";
  if (input.syncing) {
    title = "Synchronisation en cours : relais local, puis Cloud.";
  } else if (hasPending) {
    title =
      input.relay === "unavailable" && input.cloud === "unavailable"
        ? "Réessayer le relais local et le Cloud. Les données restent protégées sur le téléphone."
        : "Essayer le relais local d’abord, puis le Cloud s’il est disponible.";
  }

  return {
    cloud,
    relay,
    data,
    sync: {
      enabled,
      label: input.syncing
        ? "Synchronisation…"
        : hasPending
          ? `Synchroniser (${input.pending.total})`
          : "Synchronisé",
      title,
    },
  };
}

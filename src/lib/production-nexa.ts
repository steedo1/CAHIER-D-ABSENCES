import { schoolCardClasses, type SchoolCard } from "./school-cards";

export const PRODUCTION_ROLE = "nexa_production";
export const PRODUCTION_PERMISSIONS = ["cards.read", "cards.orders", "cards.generate", "cards.download"] as const;
export type ProductionPermission = typeof PRODUCTION_PERMISSIONS[number];
export const ORDER_STATUSES = ["pending", "preparing", "ready", "completed", "cancelled"] as const;
export type OrderStatus = typeof ORDER_STATUSES[number];
export const ORDER_LABELS: Record<OrderStatus, string> = {
  pending: "En attente", preparing: "En préparation", ready: "Prête", completed: "Terminée", cancelled: "Annulée",
};
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ["preparing", "cancelled"], preparing: ["ready", "cancelled"], ready: ["preparing", "completed", "cancelled"],
  completed: [], cancelled: [],
};
export const PDF_BATCH_SIZE = 40;
export const PDF_MAX_BYTES = 12 * 1024 * 1024;
export type ArchiveClass = { level: string; label: string };
export type ArchiveStudent = { id: string; name: string; matricule: string; classes?: ArchiveClass[] };
export function productionArchiveStudent(card: SchoolCard): ArchiveStudent {
  return { id: card.studentId, name: card.name, matricule: card.matricule,
    classes: schoolCardClasses(card).map(({ level, label }) => ({ level, label })) };
}
export function archiveClassSummary(students: ArchiveStudent[]): ArchiveClass[] {
  const distinct = new Map<string, ArchiveClass>();
  for (const student of students) for (const classe of student.classes ?? []) {
    if (!classe.label && !classe.level) continue;
    distinct.set(JSON.stringify([classe.level, classe.label]), classe);
  }
  return [...distinct.values()].sort((a, b) => a.level.localeCompare(b.level, "fr", { numeric: true }) ||
    a.label.localeCompare(b.label, "fr", { numeric: true }));
}
export function archiveClassTitle(classes: ArchiveClass[]) {
  return classes.map(({ level, label }) => {
    if (!label) return level;
    if (!level || label.toLocaleLowerCase("fr").startsWith(level.toLocaleLowerCase("fr"))) return label;
    return [level, label].join(" — ");
  }).join(" · ");
}
export function productionUpload(pdf: Blob, students: ArchiveStudent[]) {
  const manifest = new TextEncoder().encode(JSON.stringify(students));
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, manifest.byteLength);
  return new Blob([length, manifest, pdf], { type: "application/vnd.nexa.card-production" });
}
export const PRODUCTION_BUCKET = "nexa-production-cards";
export type ProductionOrder = {
  id: string; academic_year: string; status: OrderStatus; student_ids: string[];
  created_at: string; submitted_by: string; revision: number;
};
export type ProductionArchive = {
  id: string; order_id: string | null; previous_id: string | null; version: number;
  academic_year: string; actor_id: string; actor_name?: string; student_ids: string[]; students: ArchiveStudent[];
  recovered_classes?: ArchiveClass[];
  format: "pvc" | "a4"; flip: "long" | "short"; created_at: string;
};
export type ProductionEvent = {
  id: number; actor_id: string; action: string; subject_id: string; created_at: string;
  details: Record<string, unknown>;
};
export const PRODUCTION_EVENT_LABELS: Record<string,string> = {
  cards_prepared: "Cartes préparées", created: "Compte créé", updated: "Autorisations ou état modifiés", order_submitted: "Commande transmise",
  order_updated: "Statut de commande modifié", generated: "PDF archivé", regenerated: "Nouvelle version archivée",
  downloaded: "Téléchargement du PDF", assets_requested: "Visuels de production demandés",
  asset_original_recovered: "Original de cachet ou signature récupéré",
};

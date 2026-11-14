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
export function productionUpload(pdf: Blob, students: { id: string; name: string; matricule: string }[]) {
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
  academic_year: string; actor_id: string; actor_name?: string; student_ids: string[]; students: { id: string; name: string; matricule: string }[];
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

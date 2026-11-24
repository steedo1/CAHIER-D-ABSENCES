import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { getRequestRoles } from "@/lib/auth/server-context";
import { getSupabaseServerClient, getVerifiedServerUser } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { CARD_UUID } from "@/lib/school-card-token";
import { cardFeatureEnabled, cardJson, loadCardClasses, loadCardEnrollments, loadCardScope, type CardScope } from "./school-cards";
import { PDF_BATCH_SIZE, PRODUCTION_ROLE, archiveClassSummary, type ArchiveStudent, type ProductionArchive, type ProductionPermission } from "@/lib/production-nexa";

export const ORDER_FIELDS = "id,academic_year,status,student_ids,created_at,submitted_by,revision";
export const ARCHIVE_FIELDS = "id,order_id,previous_id,version,academic_year,actor_id,student_ids,students,format,flip,created_at";
export const EVENT_FIELDS = "id,actor_id,action,subject_id,created_at,details";
export const ACCOUNT_FIELDS = "user_id,email,status,permissions,all_schools,institution_ids,revision,created_at";
export const isUuid = (value: unknown): value is string => typeof value === "string" && CARD_UUID.test(value);
export const isYear = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{4}$/.test(value);
export const activeOrder = (status: string) => ["pending", "preparing", "ready"].includes(status);

export async function readProductionAccount(service: SupabaseClient, userId: string) {
  return service.from("nexa_production_accounts").select(ACCOUNT_FIELDS).eq("user_id", userId).maybeSingle();
}

export async function productionAccess() {
  if (!cardFeatureEnabled()) return { error: cardJson({ error: "module_non_active" }, 404) } as const;
  const client = await getSupabaseServerClient();
  const { data: { user }, error } = await getVerifiedServerUser(client);
  if (error || !user) return { error: cardJson({ error: "connexion_requise" }, 401) } as const;
  const service = getSupabaseServiceClient();
  if (user.role === PRODUCTION_ROLE) {
    const access = await readProductionAccount(service, user.id);
    if (access.error) return { error: cardJson({ error: "autorisations_indisponibles" }, 503) } as const;
    if (access.data?.status !== "active") return { error: cardJson({ error: "compte_production_inactif" }, 403) } as const;
    return { service, userId: user.id, account: access.data } as const;
  }
  const roles = await getRequestRoles(client, service, user.id);
  if (roles.error) return { error: cardJson({ error: "autorisations_indisponibles" }, 503) } as const;
  if (!roles.data?.some(row => row.role === "super_admin")) return { error: cardJson({ error: "acces_production_refuse" }, 403) } as const;
  return { service, userId: user.id, account: null } as const;
}

export type ProductionAccess = Exclude<Awaited<ReturnType<typeof productionAccess>>, { error: unknown }>;
export function canProduce(access: ProductionAccess, permission: ProductionPermission, instId?: string) {
  const account = access.account;
  return !account || (account.permissions.includes(permission) &&
    (!instId || account.all_schools || account.institution_ids.includes(instId)));
}
export async function productionSchool(access: ProductionAccess, instId: unknown, permission: ProductionPermission) {
  if (!isUuid(instId)) return { error: cardJson({ error: "etablissement_invalide" }, 400) } as const;
  if (!canProduce(access, permission, instId)) return { error: cardJson({ error: "autorisation_insuffisante" }, 403) } as const;
  return loadCardScope(access.service, instId, access.userId);
}

export async function readLimited(req: NextRequest, limit: number) {
  if (Number(req.headers.get("content-length") || 0) > limit) throw new ProductionError("requete_trop_volumineuse", 413);
  const reader = req.body?.getReader();
  if (!reader) throw new ProductionError("requete_vide", 400);
  let total = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new ProductionError("requete_trop_volumineuse", 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, total);
}

export async function productionJson(req: NextRequest, limit = 16_000) {
  if (!req.headers.get("content-type")?.startsWith("application/json")) throw new ProductionError("json_requis", 415);
  const bytes = await readLimited(req, limit);
  try {
    const value = JSON.parse(bytes.toString("utf8"));
    if (!value || Array.isArray(value) || typeof value !== "object") throw Error();
    return value as Record<string, unknown>;
  } catch { throw new ProductionError("requete_invalide", 400); }
}
export class ProductionError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
export function productionFailure(error: unknown) {
  if (error instanceof ProductionError) return cardJson({ error: error.message }, error.status);
  console.error("[production-nexa]", error instanceof Error ? error.message : "operation_failed");
  return cardJson({ error: "operation_production_indisponible" }, 503);
}

export function studentSelection(input: unknown, max: number) {
  if (!Array.isArray(input) || !input.length || input.length > max || !input.every(isUuid)) {
    throw new ProductionError("selection_invalide", 400);
  }
  return [...new Set<string>(input.map(id => id.toLowerCase()))].sort();
}

export async function selectedCards(ctx: CardScope, year: string, ids: string[], includePhotos = false) {
  const classes = await loadCardClasses(ctx, year);
  const items = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const { items: batch } = await loadCardEnrollments(ctx, year, { studentIds: ids.slice(offset, offset + 100), includePhotos, classes });
    items.push(...batch);
  }
  const byStudent = new Map(items.map(card => [card.studentId, card]));
  if (byStudent.size !== ids.length || items.some(card => card.revoked) || byStudent.size !== items.length) {
    throw new ProductionError("selection_interdite_carte_invalidee_ou_eleve_hors_perimetre", 403);
  }
  return ids.map(id => byStudent.get(id)!);
}


type GenerationTicket = {
  id: string; actorId: string; institutionId: string; year: string; orderId: string | null; previousId: string | null;
  version: number; batchKey: string; format: "pvc" | "a4"; flip: "long" | "short"; expires: number;
  studentIds: string[]; studentsDigest: string;
};
function signTicket(payload: string) {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (secret.length < 32) throw Error("production_ticket_secret_missing");
  return createHmac("sha256", secret).update("nexa-pdf-upload:v1:").update(payload).digest();
}
export function productionBatchKey(school: string, year: string, order: string | null, format: unknown, flip: unknown, ids: string[]) {
  return createHash("sha256").update(JSON.stringify([school, year, order, format, flip, ids])).digest("hex");
}
export function productionStudentsDigest(students: ArchiveStudent[]) {
  return createHash("sha256").update(JSON.stringify(students.map(({ id, name, matricule, classes }) => ({
    id, name, matricule, ...(classes !== undefined && { classes: classes.map(({ level, label }) => ({ level, label })) }),
  })))).digest("hex");
}

/** Older PDF manifests omitted class labels. Recover the historical enrollment where possible,
 * without modifying any stored archive or claiming that the old PDF contained these labels. */
export async function recoverArchiveClasses(ctx: CardScope, year: string, archives: ProductionArchive[]) {
  const old = archives.filter(row => row.students.some(student => student.classes === undefined));
  if (!old.length) return new Map<string, ReturnType<typeof archiveClassSummary>>();
  const classes = await loadCardClasses(ctx, year);
  const byClass = new Map(classes.map(row => [row.id, row]));
  const ids = [...new Set(old.flatMap(row => row.student_ids))];
  type Enrollment = { student_id: string; class_id: string; start_date: string | null; end_date: string | null };
  const byStudent = new Map<string, Enrollment[]>();
  for (let offset = 0; offset < ids.length; offset += 100) {
    const { data, error } = await ctx.service.from("class_enrollments").select("student_id,class_id,start_date,end_date")
      .eq("institution_id", ctx.instId).in("student_id", ids.slice(offset, offset + 100));
    if (error) throw Error("classes_archive_indisponibles");
    for (const row of (data ?? []) as Enrollment[]) {
      if (!byClass.has(row.class_id)) continue;
      const list = byStudent.get(row.student_id) ?? [];
      list.push(row);
      byStudent.set(row.student_id, list);
    }
  }
  return new Map(old.map(row => {
    const day = row.created_at.slice(0, 10);
    const recovered = row.students.map(student => ({
      ...student,
      classes: student.classes ?? (byStudent.get(student.id) ?? [])
        .filter(enrollment => enrollment.start_date && enrollment.start_date <= day &&
          (!enrollment.end_date || enrollment.end_date >= day))
        .map(enrollment => byClass.get(enrollment.class_id)!)
        .map(classe => ({ level: classe.level ?? "", label: classe.label })),
    }));
    return [row.id, archiveClassSummary(recovered)] as const;
  }));
}
export function issueGenerationTicket(data: Omit<GenerationTicket, "id" | "expires">) {
  const payload = Buffer.from(JSON.stringify({ ...data, id: randomUUID(), expires: Date.now() + 20 * 60_000 })).toString("base64url");
  return payload + "." + signTicket(payload).toString("base64url");
}
export function openGenerationTicket(value: string | null, actorId: string) {
  if (!value || value.length > 24_000) throw new ProductionError("autorisation_de_generation_invalide", 403);
  const [payload, signature, extra] = value.split(".");
  const signed = Buffer.from(signature || "", "base64url");
  const expected = signTicket(payload);
  if (extra !== undefined || signed.length !== expected.length || !timingSafeEqual(signed, expected)) {
    throw new ProductionError("autorisation_de_generation_invalide", 403);
  }
  const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as GenerationTicket;
  if (data.actorId !== actorId || data.expires < Date.now() || data.studentIds.length > PDF_BATCH_SIZE) {
    throw new ProductionError("autorisation_de_generation_expiree_ou_interdite", 403);
  }
  return data;
}

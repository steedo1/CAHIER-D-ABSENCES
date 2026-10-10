import { NextRequest, NextResponse } from "next/server";
import { requireInstitutionAccess } from "../_helpers/institutionAccess";
import { PARENT_CONNECT_READ_ROLES, PARENT_CONNECT_WRITE_ROLES, PARENT_CONNECT_SETTINGS_ROLES, PAYMENT_METHODS, hasParentConnectRole, parentConnectStatus } from "@/lib/parent-connect/domain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

function operationError(message: string) {
  const errors: Record<string, string> = {
    PARENT_CONNECT_STALE_SUBSCRIPTION: "L’abonnement a changé. Actualisez la liste avant d’encaisser.",
    PARENT_CONNECT_OPERATION_CONFLICT: "Cette opération a déjà été utilisée. Actualisez la liste.",
    PARENT_CONNECT_STUDENT_NOT_FOUND: "Élève introuvable dans cet établissement.",
    PARENT_CONNECT_MATRICULE_REQUIRED: "Renseignez le matricule de l’élève avant d’activer Parent Connect.",
    PARENT_CONNECT_REMITTANCE_EXCEEDS_DUE: "Le reversement dépasse le montant restant dû à Nexa Digital.",
    PARENT_CONNECT_FORBIDDEN: "Vous n’êtes pas autorisé à enregistrer cette opération.",
  };
  return errors[message] || "Parent Connect n’est pas encore disponible. Vérifiez son installation avant d’encaisser.";
}

export async function GET(req: NextRequest) {
  const access = await requireInstitutionAccess({ allowedRoles: PARENT_CONNECT_READ_ROLES });
  if (access.error) return access.error;
  const { srv, institutionId, roles } = access;
  try {
    const params = req.nextUrl.searchParams;
    const q = (params.get("q") || "").slice(0, 80).replace(/[^\p{L}\p{N}\s'-]/gu, "").trim();
    const page = Math.max(0, Math.min(10000, Number.parseInt(params.get("page") || "0", 10) || 0));
    const classId = params.get("class_id") || "";
    const level = (params.get("level") || "").slice(0, 80);
    if (classId && !UUID.test(classId)) return json({ error: "Classe invalide." }, 400);
    const [settings, classes, institution, summary, payments, remittances, currentYear] = await Promise.all([
      srv.from("parent_connect_school_settings").select("enforcement_enabled").eq("institution_id", institutionId).maybeSingle(),
      srv.from("classes").select("id,label,level,formation_level_code,academic_year").eq("institution_id", institutionId).order("label").limit(1000),
      srv.from("institutions").select("name").eq("id", institutionId).single(),
      srv.rpc("parent_connect_summary", { p_institution_id: institutionId }),
      srv.from("parent_connect_payments").select("id,student_id,student_name,matricule,payer_name,payment_method,payment_reference,amount,receipt_no,starts_at,ends_at,created_at").eq("institution_id", institutionId).order("created_at", { ascending: false }).limit(30),
      srv.from("parent_connect_remittances").select("id,amount,reference,created_at").eq("institution_id", institutionId).order("created_at", { ascending: false }).limit(30),
      srv.from("academic_years").select("code").eq("institution_id", institutionId).eq("is_current", true).limit(1).maybeSingle(),
    ]);
    if ([settings, classes, institution, summary, payments, remittances, currentYear].some((r) => r.error)) return json({ error: "Parent Connect doit être installé avant de pouvoir enregistrer les abonnements." }, 503);
    let query = srv.from("students").select("id,matricule,first_name,last_name", { count: "exact" }).eq("institution_id", institutionId);
    if (q) for (const term of q.split(/\s+/).slice(0, 8)) query = query.or(`full_name.ilike.%${term}%,matricule.ilike.%${term}%,last_name.ilike.%${term}%,first_name.ilike.%${term}%`);
    const year = currentYear.data?.code || "";
    const currentClasses = (classes.data || []).filter((c) => !year || c.academic_year === year);
    const scopedClasses = currentClasses.filter((c) => (!classId || c.id === classId) && (!level || (c.formation_level_code || c.level || "") === level));
    if (classId || level) {
      const ids: string[] = [];
      for (let offset = 0; ; offset += 1000) {
        const enrollment = await srv.from("class_enrollments").select("student_id").eq("institution_id", institutionId).in("class_id", scopedClasses.length ? scopedClasses.map((c) => c.id) : ["00000000-0000-0000-0000-000000000000"]).is("end_date", null).order("student_id").range(offset, offset + 999);
        if (enrollment.error) throw enrollment.error;
        ids.push(...(enrollment.data || []).map((r) => r.student_id));
        if ((enrollment.data || []).length < 1000) break;
      }
      query = query.in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
    }
    const students = await query.order("last_name").order("first_name").order("id").range(page * 40, page * 40 + 39);
    if (students.error) throw students.error;
    const ids = (students.data || []).map((s) => s.id);
    const [accounts, enrollments] = ids.length ? await Promise.all([
      srv.from("parent_connect_accounts").select("student_id,starts_at,ends_at").eq("institution_id", institutionId).in("student_id", ids),
      srv.from("class_enrollments").select("student_id,classes:class_id(label,academic_year)").eq("institution_id", institutionId).in("student_id", ids).in("class_id", currentClasses.length ? currentClasses.map((c) => c.id) : ["00000000-0000-0000-0000-000000000000"]).is("end_date", null),
    ]) : [{ data: [], error: null }, { data: [], error: null }];
    if (accounts.error || enrollments.error) throw accounts.error || enrollments.error;
    const accountById = new Map((accounts.data || []).map((r) => [r.student_id, r]));
    const classById = new Map((enrollments.data || []).map((r: any) => [r.student_id, r.classes?.label || ""]));
    return json({
      institution_name: institution.data?.name || "Établissement",
      enforcement_enabled: settings.data?.enforcement_enabled === true,
      can_collect: hasParentConnectRole(roles, PARENT_CONNECT_WRITE_ROLES),
      can_configure: hasParentConnectRole(roles, PARENT_CONNECT_SETTINGS_ROLES),
      classes: currentClasses.map((c) => ({ ...c, level: c.formation_level_code || c.level || "" })), academic_year: year, page, total: students.count || 0,
      items: (students.data || []).map((s) => ({ ...s, full_name: `${s.last_name || ""} ${s.first_name || ""}`.trim(), class_label: classById.get(s.id) || "", parent_connect: parentConnectStatus(true, accountById.get(s.id)?.ends_at) })),
      summary: { ...summary.data, due: Number(summary.data?.nexa_share || 0) - Number(summary.data?.remitted || 0) },
      payments: payments.data || [], remittances: remittances.data || [],
    });
  } catch { return json({ error: "Impossible de charger les abonnements. Réessayez." }, 503); }
}

export async function POST(req: NextRequest) {
  const access = await requireInstitutionAccess({ allowedRoles: PARENT_CONNECT_WRITE_ROLES });
  if (access.error) return access.error;
  const body = await req.json().catch(() => null);
  if (!body || !UUID.test(String(body.operation_id || ""))) return json({ error: "Opération invalide." }, 400);
  if (body.action === "remit") {
    const amount = Number(body.amount);
    const reference = String(body.reference || "").trim();
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 2147483647 || reference.length < 2 || reference.length > 160) return json({ error: "Renseignez un montant entier et une référence de reversement." }, 400);
    const { data, error } = await access.srv.rpc("parent_connect_remit", { p_institution_id: access.institutionId, p_actor_id: access.user.id, p_operation_id: body.operation_id, p_amount: amount, p_reference: reference });
    return error ? json({ error: operationError(error.message) }, 409) : json({ remittance: data });
  }
  const payer = String(body.payer_name || "").trim();
  const reference = String(body.payment_reference || "").trim();
  const expected = body.expected_ends_at ?? null;
  if (!UUID.test(String(body.student_id || "")) || payer.length < 2 || payer.length > 160 || reference.length > 160 || !PAYMENT_METHODS.includes(body.payment_method) || (expected !== null && (typeof expected !== "string" || !Number.isFinite(Date.parse(expected))))) return json({ error: "Renseignez l’élève, le payeur et le mode de règlement." }, 400);
  const { data, error } = await access.srv.rpc("parent_connect_collect", {
    p_institution_id: access.institutionId, p_student_id: body.student_id,
    p_actor_id: access.user.id, p_operation_id: body.operation_id,
    p_payer_name: payer, p_payment_method: body.payment_method,
    p_payment_reference: reference, p_expected_ends_at: expected,
  });
  return error ? json({ error: operationError(error.message) }, 409) : json({ payment: data });
}

export async function PATCH(req: NextRequest) {
  const access = await requireInstitutionAccess({ allowedRoles: PARENT_CONNECT_SETTINGS_ROLES });
  if (access.error) return access.error;
  const body = await req.json().catch(() => null);
  if (typeof body?.enforcement_enabled !== "boolean") return json({ error: "Paramètre invalide." }, 400);
  const { error } = await access.srv.from("parent_connect_school_settings").upsert({ institution_id: access.institutionId, enforcement_enabled: body.enforcement_enabled, updated_by: access.user.id, updated_at: new Date().toISOString() });
  return error ? json({ error: "Impossible de modifier le mode Parent Connect." }, 503) : json({ ok: true });
}

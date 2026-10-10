import { parentConnectOperationError as operationError } from "@/lib/parent-connect/errors";
import { NextRequest, NextResponse } from "next/server";
import { requireInstitutionAccess } from "../_helpers/institutionAccess";
import { PARENT_CONNECT_READ_ROLES, PARENT_CONNECT_WRITE_ROLES, PAYMENT_METHODS, hasParentConnectRole, parentConnectStatus } from "@/lib/parent-connect/domain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });


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
      srv.from("parent_connect_school_settings").select("enforcement_enabled,activations_paused,approved_academic_year,approved_ends_at").eq("institution_id", institutionId).maybeSingle(),
      srv.from("classes").select("id,label,level,formation_level_code,academic_year").eq("institution_id", institutionId).order("label").limit(1000),
      srv.from("institutions").select("name").eq("id", institutionId).single(),
      srv.rpc("parent_connect_summary", { p_institution_id: institutionId }),
      srv.from("parent_connect_payments").select("id,student_id,student_name,matricule,payer_name,payment_method,payment_reference,amount,receipt_no,starts_at,ends_at,created_at").eq("institution_id", institutionId).order("created_at", { ascending: false }).limit(30),
      srv.from("parent_connect_remittances").select("id,amount,reference,created_at,parent_connect_credit_grants(id)").eq("institution_id", institutionId).order("created_at", { ascending: false }).limit(30),
      srv.from("academic_years").select("code,end_date").eq("institution_id", institutionId).eq("is_current", true).maybeSingle(),
    ]);
    if ([settings, classes, institution, summary, payments, remittances, currentYear].some((r) => r.error)) return json({ error: "Parent Connect doit être installé avant de pouvoir enregistrer les abonnements." }, 503);
    const year = currentYear.data?.code || "";
    const currentClasses = (classes.data || []).filter((c) => c.academic_year === year);
    const students = await srv.rpc("parent_connect_students", { p_institution_id: institutionId, p_academic_year: year, p_search: q, p_class_id: classId || null, p_level: level, p_offset: page * 40 });
    if (students.error) throw students.error;
    const items: { id: string; matricule: string | null; first_name: string | null; last_name: string | null; class_label: string }[] = students.data?.items || [];
    const ids = items.map((s) => s.id);
    const accounts = ids.length ? await srv.from("parent_connect_accounts").select("student_id,starts_at,ends_at,source").eq("institution_id", institutionId).eq("academic_year", year).in("student_id", ids) : { data: [], error: null };
    if (accounts.error) throw accounts.error;
    const accountById = new Map((accounts.data || []).map((r) => [r.student_id, r]));
    const approvedEnd = settings.data?.approved_academic_year === year ? settings.data?.approved_ends_at : null;
    const calendarEnd = currentYear.data?.end_date ? new Date(Date.parse(`${currentYear.data.end_date}T00:00:00Z`) + 86400_000).toISOString() : null;
    const endFor = (end?: string | null) => end && approvedEnd && calendarEnd ? new Date(Math.min(Date.parse(end), Date.parse(approvedEnd), Date.parse(calendarEnd))).toISOString() : null;
    const effectiveEnd = approvedEnd && calendarEnd ? endFor(approvedEnd) : calendarEnd;
    return json({
      institution_name: institution.data?.name || "Établissement",
      enforcement_enabled: settings.data?.enforcement_enabled === true,
      can_collect: hasParentConnectRole(roles, PARENT_CONNECT_WRITE_ROLES),
      can_configure: false,
      activations_paused: settings.data?.activations_paused === true,
      school_end_date: effectiveEnd ? new Date(Date.parse(effectiveEnd) - 1).toISOString().slice(0, 10) : null,
      classes: currentClasses.map((c) => ({ ...c, level: c.formation_level_code || c.level || "" })), academic_year: year, page, total: students.data?.total || 0,
      items: items.map((s) => ({ ...s, full_name: `${s.last_name || ""} ${s.first_name || ""}`.trim(), coverage_source: accountById.get(s.id)?.source || null, parent_connect: parentConnectStatus(true, endFor(accountById.get(s.id)?.ends_at)) })),
      summary: summary.data,
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
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount % 1500 !== 0 || amount > 2147483647 || reference.length < 2 || reference.length > 160) return json({ error: "Renseignez un montant entier et une référence de reversement." }, 400);
    const { data, error } = await access.srv.rpc("parent_connect_remit", { p_institution_id: access.institutionId, p_actor_id: access.user.id, p_operation_id: body.operation_id, p_amount: amount, p_reference: reference, p_academic_year: String(body.academic_year || "") });
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
    p_payment_reference: reference, p_expected_ends_at: expected, p_academic_year: String(body.academic_year || ""),
  });
  return error ? json({ error: operationError(error.message) }, 409) : json({ payment: data });
}

export async function PATCH() {
  return json({ error: "Le mode d’accès est géré exclusivement depuis l’espace super admin." }, 403);
}

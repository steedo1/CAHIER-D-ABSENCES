import { NextRequest, NextResponse } from "next/server";
import { requireParentConnectSuper } from "@/lib/parent-connect/super-access";
import { parentConnectOperationError } from "@/lib/parent-connect/errors";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(req: NextRequest) {
  const access = await requireParentConnectSuper();
  if (access.error) return access.error;
  try {
    const id = req.nextUrl.searchParams.get("institution_id");
    if (!id) {
      const search = (req.nextUrl.searchParams.get("q") || "").slice(0, 80).replace(/[%_\\]/g, "");
      const page = Math.max(0, Math.min(10000, Number.parseInt(req.nextUrl.searchParams.get("page") || "0", 10) || 0));
      const result = await access.srv.rpc("parent_connect_super_overview", { p_search: search, p_offset: page * 30 });
      return result.error ? json({ error: "Installez Parent Connect pour accéder à son pilotage." }, 503) : json({ ...result.data, page });
    }
    if (!UUID.test(id)) return json({ error: "Établissement invalide." }, 400);
    const [institution, year, settings, summary, grants, remittances, bulk, payments, channels, phoneChanges, activations] = await Promise.all([
      access.srv.from("institutions").select("id,name").eq("id", id).single(),
      access.srv.from("academic_years").select("code,end_date").eq("institution_id", id).eq("is_current", true).maybeSingle(),
      access.srv.from("parent_connect_school_settings").select("enforcement_enabled,activations_paused,approved_academic_year,approved_ends_at").eq("institution_id", id).maybeSingle(),
      access.srv.rpc("parent_connect_summary", { p_institution_id: id }),
      access.srv.from("parent_connect_credit_grants").select("id,academic_year,quantity,amount_received,reference,remittance_id,confirmed_by,confirmed_at").eq("institution_id", id).order("confirmed_at", { ascending: false }).limit(30),
      access.srv.from("parent_connect_remittances").select("id,academic_year,amount,reference,created_by,created_at,parent_connect_credit_grants(id)").eq("institution_id", id).order("created_at", { ascending: false }).limit(100),
      access.srv.from("parent_connect_bulk_operations").select("id,academic_year,reference,eligible_count,skipped_no_matricule,ends_at,created_by,created_at").eq("institution_id", id).order("created_at", { ascending: false }).limit(30),
      access.srv.from("parent_connect_payments").select("id,academic_year,student_name,matricule,payer_name,sms_phone_e164,receipt_no,amount,school_share,nexa_share,created_by,created_at").eq("institution_id", id).order("created_at", { ascending: false }).limit(30),
      access.srv.from("institution_notification_channel_settings").select("sms_premium_enabled,sms_absence_enabled,sms_late_enabled,sms_notes_digest_enabled,sms_communication_enabled,sms_finance_reminders_enabled").eq("institution_id", id).maybeSingle(),
      access.srv.from("parent_connect_phone_changes").select("id,student_id,student_name,matricule,academic_year,previous_phone,phone_e164,changed_by,changed_at").eq("institution_id", id).order("changed_at", { ascending: false }).limit(30),
      access.srv.from("parent_connect_activations").select("id,student_name,matricule,academic_year,ends_at,created_by,created_at").eq("institution_id", id).order("created_at", { ascending: false }).limit(30),
    ]);
    if ([institution, year, settings, summary, grants, remittances, bulk, payments, channels, phoneChanges, activations].some((r) => r.error)) return json({ error: "Impossible de charger cet établissement. Vérifiez l’installation et son année scolaire." }, 503);
    const roster = year.data?.code ? await access.srv.rpc("parent_connect_roster", { p_institution_id: id, p_academic_year: year.data.code }) : { data: { eligible_count: 0, skipped_no_matricule: 0 }, error: null };
    if (roster.error) throw roster.error;
    const actorIds = [...new Set([...(phoneChanges.data || []).map((r) => r.changed_by), ...(activations.data || []).map((r) => r.created_by)].filter(Boolean))];
    const actors = actorIds.length ? await access.srv.from("profiles").select("id,display_name").in("id", actorIds) : { data: [], error: null };
    if (actors.error) throw actors.error;
    const actorNames = new Map((actors.data || []).map((r) => [r.id, r.display_name]));
    const auditedPhones = (phoneChanges.data || []).map((r) => ({ ...r, changed_by_name: actorNames.get(r.changed_by) || "Compte supprimé" }));
    return json({ activations: (activations.data || []).map((r) => ({ ...r, created_by_name: actorNames.get(r.created_by) || "Compte supprimé" })), sms_channels: channels.data || {}, phone_changes: auditedPhones, institution: institution.data, year: year.data, settings: settings.data || { enforcement_enabled: false, activations_paused: false }, summary: summary.data, roster: roster.data, grants: grants.data || [], remittances: remittances.data || [], bulk: bulk.data || [], payments: payments.data || [] });
  } catch { return json({ error: "Parent Connect est momentanément indisponible." }, 503); }
}

export async function POST(req: NextRequest) {
  const access = await requireParentConnectSuper();
  if (access.error) return access.error;
  const body = await req.json().catch(() => null);
  if (!body || !UUID.test(String(body.institution_id || ""))) return json({ error: "Établissement invalide." }, 400);
  const id = body.institution_id;
  if (body.action === "configure") {
    if (typeof body.enforcement_enabled !== "boolean" || typeof body.activations_paused !== "boolean") return json({ error: "Paramètres invalides." }, 400);
    const { error } = await access.srv.from("parent_connect_school_settings").upsert({ institution_id: id, enforcement_enabled: body.enforcement_enabled, activations_paused: body.activations_paused, updated_by: access.user.id, updated_at: new Date().toISOString() });
    return error ? json({ error: "Modification impossible." }, 503) : json({ ok: true });
  }
  if (body.action === "grant_manual") {
    const year = body.academic_year;
    const reference = typeof body.reference === "string" ? body.reference.trim() : "";
    if (!UUID.test(String(body.operation_id || "")) || typeof year !== "string" || !year || year.length > 40 || (reference.length === 1 || reference.length > 160) || body.confirmed !== true || !Number.isSafeInteger(body.quantity) || body.quantity < 1 || body.quantity > 1000000) return json({ error: "Confirmez le nombre de crédits et l’année scolaire." }, 400);
    const result = await access.srv.rpc("parent_connect_grant_activation_credits", {
      p_institution_id: id, p_actor_id: access.user.id, p_operation_id: body.operation_id,
      p_academic_year: year, p_quantity: body.quantity, p_reference: reference || "Attribution de crédits",
    });
    return result.error ? json({ error: parentConnectOperationError(result.error.message) }, 409) : json({ grant: result.data });
  }
  const reference = String(body.reference || (body.action === "bulk" && body.confirmed === true ? "Activation collective" : "")).trim();
  const year = String(body.academic_year || "");
  if (!UUID.test(String(body.operation_id || "")) || !year || year.length > 40 || reference.length < 2 || reference.length > 160 || (body.confirm_received !== true && !(body.action === "bulk" && body.confirmed === true))) return json({ error: "Confirmez l’opération et vérifiez sa référence." }, 400);
  const common = { p_institution_id: id, p_actor_id: access.user.id, p_operation_id: body.operation_id, p_academic_year: year, p_reference: reference };
  if (body.action === "grant") {
    if (!Number.isSafeInteger(body.quantity) || body.quantity < 1 || body.quantity > 1000000 || (body.remittance_id && !UUID.test(body.remittance_id))) return json({ error: "Nombre de crédits invalide." }, 400);
    const amount = body.received_amount;
    if (!Number.isSafeInteger(amount) || amount < body.quantity || amount > body.quantity * 2147483647) return json({ error: "Vérifiez le montant réellement reçu et le nombre de crédits." }, 400);
    const r = await access.srv.rpc("parent_connect_grant_credits_at_price", { ...common, p_quantity: body.quantity, p_received_amount: amount, p_remittance_id: body.remittance_id || null });
    return r.error ? json({ error: parentConnectOperationError(r.error.message) }, 409) : json({ grant: r.data });
  }
  if (body.action === "bulk") {
    if (!Number.isSafeInteger(body.expected_count) || body.expected_count < 1) return json({ error: "Aucun élève avec matricule à activer." }, 400);
    const r = await access.srv.rpc("parent_connect_bulk_activate", { ...common, p_expected_count: body.expected_count });
    return r.error ? json({ error: parentConnectOperationError(r.error.message) }, 409) : json({ bulk: r.data });
  }
  return json({ error: "Action inconnue." }, 400);
}

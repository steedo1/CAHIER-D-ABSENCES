import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { requireInstitutionRole } from "@/lib/auth/server-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Compléments des rapports 1 et 2. Sans migration: les valeurs sont
 * conservées par établissement et année dans institutions.settings_json.
 * Écriture par lot et contrôle de version pour ne pas écraser un réglage
 * modifié entre la lecture et l'enregistrement.
 */
const KEY = "school_report_fields_v1";
const REVISION = "school_report_fields_revision_v1";
const READ_ROLES = ["admin", "super_admin", "founder", "file_correspondent", "finance_manager", "finance"];
// Même périmètre de correction du profil élève que la liste de classe existante.
const WRITE_ROLES = ["admin", "super_admin", "founder", "file_correspondent", "finance_manager", "finance"];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const yearRe = /^20\d{2}-20\d{2}$/;

type Observation = { text: string; validated: true };
type YearData = {
  decisions: Record<string, string>;
  observations: Record<string, Record<string, Observation>>;
};
type Store = Record<string, YearData>;
const object = (v: unknown): Record<string, any> =>
  v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, any> : {};

function fail(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status });
}

async function context(write: boolean) {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();
  const guard = await requireInstitutionRole(supa, srv, write ? WRITE_ROLES : READ_ROLES);
  return { srv, guard };
}

function yearSlice(raw: unknown, year: string): YearData {
  const v = object(object(raw)[year]);
  const d: Record<string, string> = {};
  for (const [id, value] of Object.entries(object(v.decisions))) {
    if (uuid.test(id) && typeof value === "string") d[id] = value.slice(0, 120);
  }
  const obs: YearData["observations"] = {};
  for (const [period, entries] of Object.entries(object(v.observations))) {
    if (!uuid.test(period)) continue;
    obs[period] = {};
    for (const [id, value] of Object.entries(object(entries))) {
      const entry = object(value);
      if (uuid.test(id) && entry.validated === true && typeof entry.text === "string") {
        obs[period][id] = { text: entry.text.slice(0, 250), validated: true };
      }
    }
  }
  return { decisions: d, observations: obs };
}

export async function GET(req: NextRequest) {
  const { srv, guard } = await context(false);
  if ("error" in guard) return fail(guard.error, guard.error === "unauthorized" ? 401 : 403);
  const year = new URL(req.url).searchParams.get("academic_year") || "";
  if (!yearRe.test(year)) return fail("Année scolaire invalide.", 400);
  const { data, error } = await srv.from("institutions").select("settings_json")
    .eq("id", guard.instId).maybeSingle();
  if (error || !data) return fail("Paramètres de l'établissement indisponibles.", 503);
  const slice = yearSlice(object(data.settings_json)[KEY], year);
  return NextResponse.json({ ok: true, academic_year: year,
    decision_numbers: slice.decisions, observations: slice.observations },
    { headers: { "Cache-Control": "private, no-store" } });
}

export async function PATCH(req: NextRequest) {
  const { srv, guard } = await context(true);
  if ("error" in guard) return fail(guard.error, guard.error === "unauthorized" ? 401 : 403);
  const body = await req.json().catch(() => null);
  const classId = String(body?.class_id || "");
  const year = String(body?.academic_year || "");
  const periodId = String(body?.period_id || "");
  const decisions = Array.isArray(body?.decisions) ? body.decisions : [];
  const observations = Array.isArray(body?.observations) ? body.observations : [];
  if (!uuid.test(classId) || !yearRe.test(year) || decisions.length + observations.length < 1 ||
      decisions.length + observations.length > 250 || (observations.length && !uuid.test(periodId))) {
    return fail("Contexte ou nombre de corrections invalide.", 400);
  }
  const { data: cls, error: classError } = await srv.from("classes")
    .select("id,academic_year").eq("id", classId).eq("institution_id", guard.instId).maybeSingle();
  if (classError || !cls || cls.academic_year !== year) return fail("Classe ou année incompatible.", 403);
  if (observations.length) {
    const { data: period, error: periodError } = await srv.from("grade_periods")
      .select("id").eq("id", periodId).eq("institution_id", guard.instId)
      .eq("academic_year", year).maybeSingle();
    if (periodError || !period) return fail("Période scolaire invalide.", 403);
  }
  const ids = Array.from(new Set([...decisions, ...observations].map(x => String(x?.student_id || ""))));
  if (ids.some(x => !uuid.test(x))) return fail("Élève invalide.", 400);
  const { data: enrolled, error: enrolledError } = await srv.from("class_enrollments")
    .select("student_id").eq("institution_id", guard.instId).eq("class_id", classId)
    .in("student_id", ids);
  if (enrolledError) return fail("Inscription scolaire indisponible.", 503);
  const allowed = new Set((enrolled || []).map(x => String(x.student_id)));
  if (ids.some(id => !allowed.has(id))) return fail("Élève extérieur à la classe.", 403);
  for (const d of decisions) {
    if (typeof d?.value !== "string" || d.value.length > 120) return fail("Numéro de décision invalide.", 400);
  }
  for (const o of observations) {
    if (typeof o?.text !== "string" || o.text.length > 250 || o.validated !== true) {
      return fail("Une observation doit être validée explicitement.", 400);
    }
  }

  const { data: inst, error: readError } = await srv.from("institutions")
    .select("settings_json").eq("id", guard.instId).maybeSingle();
  if (readError || !inst) return fail("Impossible de charger les paramètres.", 503);
  const original = inst.settings_json;
  const settings = { ...object(original) };
  const existingRevision = typeof settings[REVISION] === "string" ? settings[REVISION] : null;
  const store: Store = { ...object(settings[KEY]) };
  const slice = yearSlice(store, year);
  for (const d of decisions) {
    const id = String(d.student_id);
    const value = d.value.trim();
    if (value) slice.decisions[id] = value;
    else delete slice.decisions[id];
  }
  if (observations.length) {
    const periodObs = { ...object(slice.observations[periodId]) };
    for (const o of observations) {
      const id = String(o.student_id);
      const value = o.text.trim();
      if (value) periodObs[id] = { text: value, validated: true };
      else delete periodObs[id];
    }
    slice.observations[periodId] = periodObs;
  }
  store[year] = slice;
  settings[KEY] = store;
  // CAS court : pas de comparaison de tout le JSON dans l'URL PostgREST.
  // La revision change à chaque écriture de ces champs ; les paramètres
  // institutionnels ordinaires restent préservés lors de notre mise à jour.
  settings[REVISION] = randomUUID();
  let update = srv.from("institutions").update({ settings_json: settings }).eq("id", guard.instId);
  update = existingRevision
    ? update.eq("settings_json->>" + REVISION, existingRevision)
    : update.is("settings_json->>" + REVISION, null);
  const { data: saved, error: saveError } = await update.select("id");
  if (saveError) return fail("Sauvegarde impossible : " + saveError.message, 503);
  if (!saved?.length) return fail("Les paramètres ont changé entre-temps. Rechargez les données avant de réessayer.", 409);
  return NextResponse.json({ ok: true, updated: decisions.length + observations.length },
    { headers: { "Cache-Control": "private, no-store" } });
}

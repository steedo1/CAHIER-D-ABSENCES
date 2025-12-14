// src/app/api/parent/children/grades/route.ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type EvalKind = "devoir" | "interro_ecrite" | "interro_orale";

type GradeRow = {
  id: string;
  eval_date: string;
  eval_kind: EvalKind;
  scale: number;
  coeff: number;
  title: string | null;
  score: number | null;
  subject_id: string | null;
  subject_name: string | null;
};

function toArray<T = any>(res: any): T[] {
  return Array.isArray(res?.data) ? (res.data as T[]) : [];
}

/** Accepte "YYYY-MM-DD" ou ISO, et renvoie "YYYY-MM-DD" */
function toDateOnly(input: string): string {
  if (!input) return "";
  // ISO -> YYYY-MM-DD
  if (input.length >= 10) return input.slice(0, 10);
  return input;
}

function parseCookieHeader(cookieHeader: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

/** Reconstitue sb-xxx-auth-token même s’il est chunké (.0 .1 ...) */
function getCookieValueJoined(cookies: Record<string, string>, base: string) {
  const keys = Object.keys(cookies)
    .filter((k) => k === base || k.startsWith(base + "."))
    .sort((a, b) => {
      const ai = a.includes(".") ? Number(a.split(".").pop()) : -1;
      const bi = b.includes(".") ? Number(b.split(".").pop()) : -1;
      return ai - bi;
    });
  return keys.map((k) => cookies[k] ?? "").join("");
}

function extractSupabaseAccessTokenFromRequest(req: NextRequest): string {
  const cookies = parseCookieHeader(req.headers.get("cookie"));

  const authKey =
    Object.keys(cookies)
      .find((k) => k.includes("-auth-token"))
      ?.replace(/\.\d+$/, "") || "";

  if (!authKey) return "";

  let raw = getCookieValueJoined(cookies, authKey);

  try {
    raw = decodeURIComponent(raw);
  } catch {}

  if (raw.startsWith("base64-")) {
    try {
      raw = Buffer.from(raw.slice("base64-".length), "base64").toString("utf8");
    } catch {}
  }

  let obj: any = null;
  try {
    obj = JSON.parse(raw);
  } catch {
    try {
      obj = JSON.parse(raw.replace(/^"|"$/g, ""));
    } catch {
      obj = null;
    }
  }

  return String(obj?.access_token || "");
}

async function getAuthedUser(req: NextRequest): Promise<User | null> {
  // 1) auth “normale”
  try {
    const supa = await getSupabaseServerClient();
    const { data, error } = await supa.auth.getUser();
    if (!error && data?.user) return data.user as User;
  } catch {}

  // 2) fallback : cookie -> srv.auth.getUser(token)
  try {
    const token = extractSupabaseAccessTokenFromRequest(req);
    if (!token) return null;
    const srv = getSupabaseServiceClient() as unknown as SupabaseClient;
    const { data, error } = await srv.auth.getUser(token);
    if (!error && data?.user) return data.user as User;
  } catch {}

  return null;
}

async function resolveInstitutionIdForStudent(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  student_id: string
): Promise<string | null> {
  // inscription active sinon la plus récente
  const enrActiveRes = await srv
    .from("class_enrollments")
    .select("institution_id")
    .eq("student_id", student_id)
    .is("end_date", null)
    .limit(1);

  const enrActive = toArray(enrActiveRes);
  let institution_id = (enrActive[0]?.institution_id as string | undefined) ?? null;

  if (!institution_id) {
    const anyEnrRes = await srv
      .from("class_enrollments")
      .select("institution_id, start_date")
      .eq("student_id", student_id)
      .order("start_date", { ascending: false })
      .limit(1);

    const anyEnr = toArray(anyEnrRes);
    institution_id = (anyEnr[0]?.institution_id as string | undefined) ?? null;
  }

  return institution_id;
}

async function resolveSubjectNames(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  ids: string[]
) {
  const uniq = Array.from(new Set(ids.filter(Boolean)));
  const map = new Map<string, string>();
  if (!uniq.length) return map;

  // essaie institution_subjects (custom_name) puis fallback subjects
  const instRes = await srv
    .from("institution_subjects")
    .select("id, subject_id, custom_name, subjects:subject_id(name)")
    .in("id", uniq);

  const inst = toArray(instRes);
  for (const r of inst) {
    const id = String((r as any).id);
    const nm = (r as any).custom_name || (r as any).subjects?.name || null;
    if (nm) map.set(id, nm);

    const baseId = (r as any).subject_id as string | null;
    if (baseId && nm && !map.has(baseId)) map.set(baseId, nm);
  }

  const missing = uniq.filter((x) => !map.has(x));
  if (missing.length) {
    const subsRes = await srv.from("subjects").select("id,name").in("id", missing);
    const subs = toArray(subsRes);
    for (const s of subs) map.set(String((s as any).id), String((s as any).name ?? "(inconnu)"));
  }

  return map;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);

  const studentId = url.searchParams.get("student_id") || "";
  const limitParam = url.searchParams.get("limit") || "200";

  const fromParam = toDateOnly(url.searchParams.get("from") || "");
  const toParam = toDateOnly(url.searchParams.get("to") || "");

  const periodId = url.searchParams.get("period_id") || "";
  const academicYearId = url.searchParams.get("academic_year_id") || "";
  const academicYearCode = url.searchParams.get("academic_year") || ""; // ex: "2025-2026"

  const limitRaw = Number(limitParam);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, limitRaw), 200) : 200;

  if (!studentId) {
    return NextResponse.json({ ok: false, error: "Paramètre student_id manquant." }, { status: 400 });
  }

  const srv = getSupabaseServiceClient();

  // ────────── AUTH : MODE 1 (parent_device) ──────────
  const jar = await cookies();
  const deviceId = jar.get("parent_device")?.value || "";

  let allow = false;
  let institution_id: string | null = null;
  let user: User | null = null;

  if (deviceId) {
    const { data: link } = await srv
      .from("parent_device_children")
      .select("student_id")
      .eq("device_id", deviceId)
      .eq("student_id", studentId)
      .limit(1);

    allow = !!(link && link.length);

    if (allow) {
      institution_id = await resolveInstitutionIdForStudent(srv, studentId);
      if (!institution_id) {
        return NextResponse.json({ ok: true, items: [] });
      }
    }
  }

  // ────────── AUTH : MODE 2 (guardian supabase) ──────────
  if (!allow && !deviceId) {
    user = await getAuthedUser(req);
    if (!user) {
      return NextResponse.json({ ok: false, error: "Non authentifié." }, { status: 401 });
    }

    // ✅ sécurité : parent lié à l’élève (guardian_profile_id OU parent_id)
    const okRes = await srv
      .from("student_guardians")
      .select("institution_id")
      .eq("student_id", studentId)
      .or(`guardian_profile_id.eq.${user.id},parent_id.eq.${user.id}`)
      .limit(1)
      .maybeSingle();

    const ok = (okRes as any)?.data;
    if (!ok) {
      return NextResponse.json({ ok: false, error: "Accès interdit." }, { status: 403 });
    }

    institution_id = (ok as any).institution_id ?? null;
    if (!institution_id) {
      institution_id = await resolveInstitutionIdForStudent(srv, studentId);
    }
  }

  if (!institution_id) {
    return NextResponse.json({ ok: false, error: "Institution introuvable." }, { status: 404 });
  }

  // ────────── Détermination de la fenêtre (filtre) ──────────
  let from = fromParam;
  let to = toParam;

  // 1) period_id -> start/end depuis grade_periods
  if ((!from || !to) && periodId) {
    const perRes = await srv
      .from("grade_periods")
      .select("start_date,end_date")
      .eq("institution_id", institution_id)
      .eq("id", periodId)
      .eq("is_active", true)
      .maybeSingle();

    const per = (perRes as any)?.data;
    if (per?.start_date) from = toDateOnly(String(per.start_date));
    if (per?.end_date) to = toDateOnly(String(per.end_date));
  }

  // 2) academic_year_id / academic_year(code) -> start/end depuis academic_years
  if ((!from || !to) && (academicYearId || academicYearCode)) {
    let q = srv
      .from("academic_years")
      .select("start_date,end_date")
      .eq("institution_id", institution_id);

    if (academicYearId) q = q.eq("id", academicYearId);
    else q = q.eq("code", academicYearCode);

    const ayRes = await q.maybeSingle();
    const ay = (ayRes as any)?.data;
    if (ay?.start_date) from = toDateOnly(String(ay.start_date));
    if (ay?.end_date) to = toDateOnly(String(ay.end_date));
  }

  // 3) défaut : année scolaire courante
  if (!from || !to) {
    const ayRes = await srv
      .from("academic_years")
      .select("start_date,end_date")
      .eq("institution_id", institution_id)
      .eq("is_current", true)
      .maybeSingle();

    const ay = (ayRes as any)?.data;
    if (!from && ay?.start_date) from = toDateOnly(String(ay.start_date));
    if (!to && ay?.end_date) to = toDateOnly(String(ay.end_date));
  }

  try {
    // ────────── Notes publiées + filtre dates ──────────
    let q = srv
      .from("student_grades")
      .select(
        `
        score,
        grade_evaluations!inner (
          id,
          eval_date,
          eval_kind,
          scale,
          coeff,
          is_published,
          title,
          subject_id
        )
      `
      )
      .eq("student_id", studentId)
      .eq("grade_evaluations.is_published", true);

    if (from) q = q.gte("grade_evaluations.eval_date", from);
    if (to) q = q.lte("grade_evaluations.eval_date", to);

    const { data, error } = await q;
    if (error) {
      console.error("[parent.grades] query error", error);
      return NextResponse.json({ ok: false, error: "Erreur de récupération des notes." }, { status: 500 });
    }

    const rows = (data || []) as Array<{ score: number | null; grade_evaluations: any }>;

    const flat = rows
      .map((r) => {
        const ge = r.grade_evaluations;
        const ev = Array.isArray(ge) ? ge[0] : ge;
        if (!ev?.id) return null;
        return { ev, score: r.score };
      })
      .filter(Boolean) as Array<{ ev: any; score: number | null }>;

    const subjectIds = Array.from(new Set(flat.map((x) => x.ev.subject_id).filter(Boolean))) as string[];
    const subjectNameById = await resolveSubjectNames(srv, subjectIds);

    const items: GradeRow[] = flat
      .map(({ ev, score }) => ({
        id: String(ev.id),
        eval_date: String(ev.eval_date),
        eval_kind: ev.eval_kind as EvalKind,
        scale: Number(ev.scale ?? 20),
        coeff: Number(ev.coeff ?? 1),
        title: ev.title ?? null,
        score,
        subject_id: ev.subject_id ?? null,
        subject_name: ev.subject_id ? subjectNameById.get(String(ev.subject_id)) ?? null : null,
      }))
      .sort((a, b) => b.eval_date.localeCompare(a.eval_date))
      .slice(0, limit);

    return NextResponse.json({ ok: true, items });
  } catch (e: any) {
    console.error("[parent.grades] unexpected", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Erreur serveur inattendue." },
      { status: 500 }
    );
  }
}

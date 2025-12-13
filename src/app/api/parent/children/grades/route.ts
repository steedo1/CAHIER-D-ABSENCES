// src/app/api/parent/children/grades/route.ts
import { NextRequest, NextResponse } from "next/server";
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

  // sb-<ref>-auth-token (parfois chunké)
  const authKey =
    Object.keys(cookies).find((k) => k.includes("-auth-token"))?.replace(/\.\d+$/, "") ||
    "";

  if (!authKey) return "";

  let raw = getCookieValueJoined(cookies, authKey);

  try {
    raw = decodeURIComponent(raw);
  } catch {}

  // Supabase met souvent "base64-..."
  if (raw.startsWith("base64-")) {
    try {
      raw = Buffer.from(raw.slice("base64-".length), "base64").toString("utf8");
    } catch {}
  }

  // parfois c’est une string JSON entourée de quotes
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

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const studentId = url.searchParams.get("student_id");
  const limitParam = url.searchParams.get("limit") || "200";

  const limitRaw = Number(limitParam);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(1, limitRaw), 200)
    : 200;

  if (!studentId) {
    return NextResponse.json(
      { ok: false, error: "Paramètre student_id manquant." },
      { status: 400 },
    );
  }

  const user = await getAuthedUser(req);
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Non authentifié." },
      { status: 401 },
    );
  }

  const srv = getSupabaseServiceClient();

  try {
    // ✅ sécurité : le parent doit être lié à l’élève
    const { data: link, error: linkErr } = await srv
      .from("student_guardians")
      .select("student_id")
      .eq("student_id", studentId)
      .eq("parent_id", user.id)
      .maybeSingle();

    if (linkErr) {
      console.error("[parent.grades] guardians error", linkErr);
      return NextResponse.json(
        { ok: false, error: "Erreur de vérification d’accès." },
        { status: 500 },
      );
    }
    if (!link) {
      return NextResponse.json(
        { ok: false, error: "Accès interdit." },
        { status: 403 },
      );
    }

    const { data, error } = await srv
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
      `,
      )
      .eq("student_id", studentId)
      .eq("grade_evaluations.is_published", true);

    if (error) {
      console.error("[parent.grades] query error", error);
      return NextResponse.json(
        { ok: false, error: "Erreur de récupération des notes." },
        { status: 500 },
      );
    }

    // normalise (relation inner peut renvoyer object ou array selon config)
    const rows = (data || []) as Array<{
      score: number | null;
      grade_evaluations: any;
    }>;

    const flat = rows
      .map((r) => {
        const ge = r.grade_evaluations;
        const ev = Array.isArray(ge) ? ge[0] : ge;
        if (!ev?.id) return null;
        return { ev, score: r.score };
      })
      .filter(Boolean) as Array<{ ev: any; score: number | null }>;

    const subjectIds = Array.from(
      new Set(flat.map((x) => x.ev.subject_id).filter(Boolean)),
    ) as string[];

    const subjectNameById = new Map<string, string>();
    if (subjectIds.length) {
      const { data: subs } = await srv
        .from("subjects")
        .select("id, name")
        .in("id", subjectIds);
      for (const s of (subs || []) as any[]) {
        if (s?.id) subjectNameById.set(String(s.id), String(s.name || ""));
      }
    }

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
        subject_name: ev.subject_id
          ? subjectNameById.get(String(ev.subject_id)) ?? null
          : null,
      }))
      .sort((a, b) => b.eval_date.localeCompare(a.eval_date))
      .slice(0, limit);

    return NextResponse.json({ ok: true, items });
  } catch (e: any) {
    console.error("[parent.grades] unexpected", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Erreur serveur inattendue." },
      { status: 500 },
    );
  }
}

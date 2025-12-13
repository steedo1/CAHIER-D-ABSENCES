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

  // utiles pour ton front (filtres par matière)
  subject_id: string | null;
  subject_name: string | null;
};

function parseCookieHeader(cookieHeader: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;

  const parts = cookieHeader.split(";");
  for (const p of parts) {
    const idx = p.indexOf("=");
    if (idx < 0) continue;
    const k = p.slice(0, idx).trim();
    const v = p.slice(idx + 1).trim();
    if (!k) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Supabase auth helpers stockent souvent un cookie "sb-<ref>-auth-token"
 * (parfois chunké en ".0", ".1", ...), et parfois encodé (base64-...).
 * On essaye d’en extraire access_token.
 */
function extractSupabaseAccessToken(req: NextRequest): string {
  const cookies = parseCookieHeader(req.headers.get("cookie"));

  // 1) Trouver la base du cookie auth-token
  const authBases = Object.keys(cookies)
    .filter((k) => k.includes("-auth-token"))
    .map((k) => k.replace(/\.\d+$/, "")); // retire .0 .1 etc
  const base = authBases[0];
  if (!base) return "";

  // 2) Reconstituer si chunké
  let raw = "";
  const chunks = Object.keys(cookies)
    .filter((k) => k === base || k.startsWith(base + "."))
    .sort((a, b) => {
      const ai = a.includes(".") ? Number(a.split(".").pop()) : -1;
      const bi = b.includes(".") ? Number(b.split(".").pop()) : -1;
      return ai - bi;
    });

  for (const k of chunks) raw += cookies[k] ?? "";

  // 3) decode url
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // ignore
  }

  // 4) decode base64- si présent
  if (raw.startsWith("base64-")) {
    const b64 = raw.slice("base64-".length);
    try {
      raw = Buffer.from(b64, "base64").toString("utf8");
    } catch {
      // ignore
    }
  }

  // 5) parse JSON
  // parfois c’est une string JSON, parfois une string entourée de guillemets
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

  const token = String(obj?.access_token || "");
  return token || "";
}

async function getAuthedUser(req: NextRequest): Promise<User | null> {
  // A) tentative “classique”
  try {
    const supa = await (getSupabaseServerClient as any)(req);
    const { data, error } = await supa.auth.getUser();
    if (!error && data?.user) return data.user as User;
  } catch {
    // ignore
  }

  // B) fallback sans casser : on lit le cookie Supabase et on valide via service client
  try {
    const token = extractSupabaseAccessToken(req);
    if (!token) return null;

    const srv = getSupabaseServiceClient() as unknown as SupabaseClient;
    const { data, error } = await srv.auth.getUser(token);
    if (!error && data?.user) return data.user as User;
  } catch {
    // ignore
  }

  return null;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const studentId = url.searchParams.get("student_id");
  const limitParam = url.searchParams.get("limit") || "20";

  const limitRaw = Number(limitParam);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(1, limitRaw), 200)
    : 20;

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
    // 1) Guard : parent lié à l’élève
    const { data: link, error: linkErr } = await srv
      .from("student_guardians")
      .select("student_id")
      .eq("student_id", studentId)
      .eq("parent_id", user.id)
      .maybeSingle();

    if (linkErr) {
      console.error("[parent.grades] student_guardians error", linkErr);
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

    // 2) Récup notes + évaluations publiées
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

    // 3) Normalisation (grade_evaluations peut être object OU array selon relations)
    const rawRows = (data || []) as Array<{
      score: number | null;
      grade_evaluations:
        | {
            id: string;
            eval_date: string;
            eval_kind: EvalKind;
            scale: number;
            coeff: number;
            is_published: boolean;
            title: string | null;
            subject_id: string | null;
          }
        | {
            id: string;
            eval_date: string;
            eval_kind: EvalKind;
            scale: number;
            coeff: number;
            is_published: boolean;
            title: string | null;
            subject_id: string | null;
          }[]
        | null;
    }>;

    const evals = rawRows
      .map((r) => {
        const ge: any = r.grade_evaluations;
        const ev = Array.isArray(ge) ? ge[0] : ge;
        if (!ev?.id) return null;
        return { ev, score: r.score };
      })
      .filter(Boolean) as Array<{
      ev: {
        id: string;
        eval_date: string;
        eval_kind: EvalKind;
        scale: number;
        coeff: number;
        title: string | null;
        subject_id: string | null;
      };
      score: number | null;
    }>;

    // 4) Récup subject_name si possible
    const subjectIds = Array.from(
      new Set(evals.map((x) => x.ev.subject_id).filter(Boolean) as string[]),
    );

    const subjectNameById = new Map<string, string>();
    if (subjectIds.length) {
      const { data: subs, error: subsErr } = await srv
        .from("subjects")
        .select("id, name")
        .in("id", subjectIds);

      if (!subsErr && subs) {
        for (const s of subs as any[]) {
          if (s?.id) subjectNameById.set(String(s.id), String(s.name || ""));
        }
      }
    }

    const items: GradeRow[] = evals
      .map(({ ev, score }) => ({
        id: ev.id,
        eval_date: ev.eval_date,
        eval_kind: ev.eval_kind,
        scale: Number(ev.scale ?? 20),
        coeff: Number(ev.coeff ?? 1),
        title: ev.title ?? null,
        score,
        subject_id: ev.subject_id ?? null,
        subject_name: ev.subject_id ? subjectNameById.get(ev.subject_id) ?? null : null,
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

// src/app/api/admin/institution/subject-components/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Role =
  | "super_admin"
  | "admin"
  | "educator"
  | "teacher"
  | "parent"
  | string;

type GuardOk = {
  user: { id: string };
  instId: string;
};
type GuardErr = { error: "unauthorized" | "no_institution" | "forbidden" };

type SubjectComponentRow = {
  id: string;
  subject_id: string;
  subject_name: string;
  level: string | null;       // 🆕 niveau (6e, 5e, 3e, ...)
  code: string;
  label: string;
  short_label: string | null;
  coeff_in_subject: number; // utilisé par les écrans de saisie
  coeff: number;            // alias pratique pour l'admin (même valeur)
  order_index: number;
  is_active: boolean;
};

type IncomingComponent = {
  id?: string | null; // ignoré, on remplace tout
  code?: string | null;
  label?: string | null;
  short_label?: string | null;
  coeff_in_subject?: number | string | null;
  order_index?: number | null;
  is_active?: boolean | null;
};

/* ───────── Helper auth admin ───────── */

async function guard(
  supa: SupabaseClient,
  srv: SupabaseClient
): Promise<GuardOk | GuardErr> {
  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) return { error: "unauthorized" };

  const { data: prof } = await supa
    .from("profiles")
    .select("id, role, institution_id")
    .eq("id", user.id)
    .maybeSingle();

  let instId: string | null = (prof?.institution_id as string) || null;
  let roleProfile: Role = (prof?.role as Role) ?? "";

  let roleFromUR: Role | null = null;
  if (!instId || !["admin", "super_admin"].includes(roleProfile)) {
    const { data: urRows } = await srv
      .from("user_roles")
      .select("role,institution_id")
      .eq("profile_id", user.id);

    const adminRow = (urRows || []).find((r: any) =>
      ["admin", "super_admin"].includes(String(r.role || ""))
    );
    if (adminRow) {
      roleFromUR = adminRow.role as Role;
      if (!instId && adminRow.institution_id) {
        instId = String(adminRow.institution_id);
      }
    }
  }

  const isAdmin =
    ["admin", "super_admin"].includes(roleProfile) ||
    ["admin", "super_admin"].includes(String(roleFromUR || ""));

  if (!instId) return { error: "no_institution" };
  if (!isAdmin) return { error: "forbidden" };

  return { user: { id: user.id }, instId };
}

function error(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

/* ───────── GET : liste des sous-matières ───────── */

export async function GET(req: NextRequest) {
  const supa = (await getSupabaseServerClient()) as unknown as SupabaseClient;
  const srv = getSupabaseServiceClient() as unknown as SupabaseClient;

  const g = await guard(supa, srv);
  if ("error" in g) {
    const status =
      g.error === "unauthorized" ? 401 : g.error === "forbidden" ? 403 : 400;
    return error(g.error, status);
  }

  const url = new URL(req.url);
  const subjectIdFilter = (url.searchParams.get("subject_id") || "").trim();
  const levelFilter = (url.searchParams.get("level") || "").trim(); // 🆕 niveau

  let query = srv
    .from("grade_subject_components")
    .select(
      `
      id,
      subject_id,
      code,
      label,
      short_label,
      coeff_in_subject,
      order_index,
      is_active,
      level,            -- 🆕
      subjects (
        name
      )
    `
    )
    .eq("institution_id", g.instId)
    .order("subject_id", { ascending: true })
    .order("order_index", { ascending: true });

  if (subjectIdFilter) {
    query = query.eq("subject_id", subjectIdFilter);
  }
  if (levelFilter) {
    query = query.eq("level", levelFilter);
  }

  const { data, error: dbErr } = await query;

  if (dbErr) {
    return error(dbErr.message, 400);
  }

  const items: SubjectComponentRow[] = (data || []).map((row: any) => {
    const coeff = Number(row.coeff_in_subject ?? 1);
    return {
      id: String(row.id),
      subject_id: String(row.subject_id),
      subject_name: row.subjects?.name
        ? String(row.subjects.name)
        : "Matière",
      level: row.level ? String(row.level) : null, // 🆕
      code: String(row.code || ""),
      label: String(row.label || ""),
      short_label: row.short_label ? String(row.short_label) : null,
      coeff_in_subject: coeff,
      coeff, // alias pour l’admin (même valeur)
      order_index: Number(row.order_index ?? 1),
      is_active: row.is_active !== false,
    };
  });

  return NextResponse.json({ ok: true, items });
}

/* ───────── PUT : remplace les sous-matières d’un sujet/niveau ───────── */

export async function PUT(req: NextRequest) {
  const supa = (await getSupabaseServerClient()) as unknown as SupabaseClient;
  const srv = getSupabaseServiceClient() as unknown as SupabaseClient;

  const g = await guard(supa, srv);
  if ("error" in g) {
    const status =
      g.error === "unauthorized" ? 401 : g.error === "forbidden" ? 403 : 400;
    return error(g.error, status);
  }

  const body = (await req.json().catch(() => ({}))) as {
    subject_id?: string;
    level?: string | null;       // 🆕 niveau
    items?: IncomingComponent[];
  };

  const subject_id = (body.subject_id || "").trim();
  if (!subject_id) {
    return error("Champ 'subject_id' obligatoire dans le body.", 400);
  }

  const level = (body.level ?? "").trim() || null; // "" → null = global

  const rawItems = Array.isArray(body.items) ? body.items : [];
  // On autorise de tout supprimer pour ce sujet/niveau
  if (rawItems.length === 0) {
    let delQuery = srv
      .from("grade_subject_components")
      .delete()
      .eq("institution_id", g.instId)
      .eq("subject_id", subject_id);

    if (level === null) {
      delQuery = delQuery.is("level", null);
    } else {
      delQuery = delQuery.eq("level", level);
    }

    const { error: delErr } = await delQuery;
    if (delErr) return error(delErr.message, 400);

    return NextResponse.json({
      ok: true,
      subject_id,
      level,
      inserted: 0,
    });
  }

  const normalized = rawItems
    .map((raw, idx) => {
      const label = (raw.label || "").trim();
      if (!label) return null;

      const codeBase = (raw.code || "").trim();
      const code =
        codeBase ||
        `c${idx + 1}`.toLowerCase().replace(/[^a-z0-9_]/g, "_");

      const short_label = (raw.short_label || label).trim();

      const ordRaw = Number(raw.order_index ?? idx + 1);
      const order_index =
        Number.isFinite(ordRaw) && ordRaw > 0 ? ordRaw : idx + 1;

      let coeff = 1;
      if (typeof raw.coeff_in_subject === "number") {
        coeff =
          Number.isFinite(raw.coeff_in_subject) &&
          raw.coeff_in_subject >= 0
            ? raw.coeff_in_subject
            : 1;
      } else if (
        typeof raw.coeff_in_subject === "string" &&
        raw.coeff_in_subject.trim() !== ""
      ) {
        const parsed = parseFloat(
          raw.coeff_in_subject.replace(",", ".")
        );
        if (!Number.isNaN(parsed) && parsed >= 0) {
          coeff = parsed;
        }
      }

      return {
        code,
        label,
        short_label,
        order_index,
        coeff_in_subject: coeff,
        is_active: raw.is_active !== false,
      };
    })
    .filter(Boolean) as {
    code: string;
    label: string;
    short_label: string;
    order_index: number;
    coeff_in_subject: number;
    is_active: boolean;
  }[];

  // 1) On supprime tout pour (institution, sujet, niveau)
  {
    let delQuery = srv
      .from("grade_subject_components")
      .delete()
      .eq("institution_id", g.instId)
      .eq("subject_id", subject_id);

    if (level === null) {
      delQuery = delQuery.is("level", null);
    } else {
      delQuery = delQuery.eq("level", level);
    }

    const { error: delErr } = await delQuery;
    if (delErr) return error(delErr.message, 400);
  }

  // 2) On insère la nouvelle liste
  const payload = normalized.map((c) => ({
    institution_id: g.instId,
    subject_id,
    level, // 🆕
    code: c.code,
    label: c.label,
    short_label: c.short_label,
    order_index: c.order_index,
    coeff_in_subject: c.coeff_in_subject,
    is_active: c.is_active,
  }));

  const { data, error: insErr } = await srv
    .from("grade_subject_components")
    .insert(payload)
    .select("id");

  if (insErr) return error(insErr.message, 400);

  return NextResponse.json({
    ok: true,
    subject_id,
    level,
    inserted: data?.length ?? 0,
  });
}

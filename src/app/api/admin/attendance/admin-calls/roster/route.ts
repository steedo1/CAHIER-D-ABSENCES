import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AllowedRole = "admin" | "super_admin" | "educator";

async function requireActor() {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const {
    data: { user },
  } = await supa.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }

  const { data: me, error: meErr } = await supa
    .from("profiles")
    .select("id,institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (meErr) {
    return { error: NextResponse.json({ error: meErr.message }, { status: 400 }) };
  }

  const institution_id = String(me?.institution_id || "");
  if (!institution_id) {
    return {
      error: NextResponse.json(
        { error: "no_institution", message: "Aucune institution associée." },
        { status: 400 }
      ),
    };
  }

  const { data: roleRow } = await supa
    .from("user_roles")
    .select("role")
    .eq("profile_id", user.id)
    .eq("institution_id", institution_id)
    .maybeSingle();

  const role = String(roleRow?.role || "") as AllowedRole | "";
  if (!["admin", "super_admin", "educator"].includes(role)) {
    return {
      error: NextResponse.json(
        { error: "forbidden", message: "Droits insuffisants pour cette vue." },
        { status: 403 }
      ),
    };
  }

  return { supa, srv, institution_id, user_id: user.id, role };
}

type RosterItem = {
  id: string;
  full_name: string;
  matricule: string | null;
};

function normString(v: any): string {
  return String(v ?? "").trim();
}

function uniqueRoster(items: RosterItem[]) {
  const seen = new Set<string>();
  const out: RosterItem[] = [];
  for (const it of items) {
    if (!it.id || seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
  }
  return out.sort((a, b) => a.full_name.localeCompare(b.full_name, "fr"));
}

async function tryExistingAdminStudents(req: NextRequest, class_id: string): Promise<RosterItem[]> {
  const origin = new URL(req.url).origin;
  const cookie = req.headers.get("cookie") || "";

  const res = await fetch(`${origin}/api/admin/students`, {
    method: "GET",
    headers: cookie ? { cookie } : undefined,
    cache: "no-store",
  });

  if (!res.ok) return [];

  const json = await res.json().catch(() => ({}));
  const raw = Array.isArray(json?.items)
    ? json.items
    : Array.isArray(json?.data)
    ? json.data
    : Array.isArray(json?.students)
    ? json.students
    : [];

  const mapped: RosterItem[] = [];
  for (const row of raw) {
    const rowClassId =
      normString(row?.class_id) ||
      normString(row?.classId) ||
      normString(row?.class?.id) ||
      normString(row?.current_class_id);

    if (rowClassId !== class_id) continue;

    const id =
      normString(row?.student_id) ||
      normString(row?.id) ||
      normString(row?.student?.id);

    const full_name =
      normString(row?.full_name) ||
      normString(row?.display_name) ||
      normString(row?.name) ||
      [
        normString(row?.last_name || row?.lastname),
        normString(row?.first_name || row?.firstname),
      ]
        .filter(Boolean)
        .join(" ")
        .trim();

    const matricule =
      normString(row?.matricule) ||
      normString(row?.registration_number) ||
      normString(row?.student_number) ||
      null;

    if (!id || !full_name) continue;
    mapped.push({ id, full_name, matricule });
  }

  return uniqueRoster(mapped);
}

export async function GET(req: NextRequest) {
  const auth = await requireActor();
  if ("error" in auth) return auth.error;

  const { srv, institution_id } = auth;
  const url = new URL(req.url);
  const class_id = String(url.searchParams.get("class_id") || "").trim();

  if (!class_id) {
    return NextResponse.json(
      { error: "class_id_required", message: "class_id requis." },
      { status: 400 }
    );
  }

  const { data: cls, error: cErr } = await srv
    .from("classes")
    .select("id,label,institution_id")
    .eq("institution_id", institution_id)
    .eq("id", class_id)
    .maybeSingle();

  if (cErr) {
    return NextResponse.json({ error: cErr.message }, { status: 400 });
  }
  if (!cls) {
    return NextResponse.json(
      { error: "class_not_found", message: "Classe introuvable." },
      { status: 404 }
    );
  }

  try {
    const existing = await tryExistingAdminStudents(req, class_id);
    if (existing.length > 0) {
      return NextResponse.json({ ok: true, items: existing });
    }
  } catch (e: any) {
    console.warn("[admin-calls/roster] existing_admin_students_failed", {
      error: e?.message || String(e),
    });
  }

  try {
    const { data, error } = await srv
      .from("students")
      .select("id,full_name,matricule,class_id,institution_id")
      .eq("institution_id", institution_id)
      .eq("class_id", class_id)
      .order("full_name");

    if (error) throw error;

    const items = uniqueRoster(
      (data || []).map((row: any) => ({
        id: String(row.id),
        full_name: normString(row.full_name),
        matricule: normString(row.matricule) || null,
      }))
    );

    if (items.length > 0) {
      return NextResponse.json({ ok: true, items });
    }

    return NextResponse.json(
      {
        error: "roster_empty",
        message:
          "Aucun élève trouvé pour cette classe. Vérifiez l’affectation des élèves à la classe.",
      },
      { status: 404 }
    );
  } catch (e: any) {
    console.error("[admin-calls/roster] fallback_failed", {
      error: e?.message || String(e),
    });

    return NextResponse.json(
      {
        error: "roster_unavailable",
        message:
          "Le roster n’est pas encore disponible pour ce module. Branchez /api/admin/students ou adaptez cette route à votre source élève centrale.",
      },
      { status: 400 }
    );
  }
}
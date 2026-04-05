import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RequestStatus = "pending" | "approved" | "rejected" | "cancelled";
type ActionKind = "approve" | "reject";

type AdminAbsenceRequestItem = {
  id: string;
  institution_id: string;
  teacher_user_id: string;
  teacher_profile_id: string;
  teacher_name: string | null;
  start_date: string;
  end_date: string;
  reason_code: string;
  reason_label: string;
  details: string;
  requested_days: number;
  signed: boolean;
  source: string;
  status: RequestStatus;
  admin_comment: string | null;
  approved_at: string | null;
  approved_by: string | null;
  rejected_at: string | null;
  rejected_by: string | null;
  created_at: string;
  updated_at: string | null;
  lost_hours_total: number;
  lost_sessions_total: number;
  impact_summary: unknown;
  makeup_plan: unknown;
};

async function getAdminContext() {
  const supa = await getSupabaseServerClient();

  const {
    data: { user },
    error: authErr,
  } = await supa.auth.getUser();

  if (authErr || !user) {
    return { ok: false as const, status: 401, error: "Non authentifié." };
  }

  const { data: me, error: meErr } = await supa
    .from("profiles")
    .select("id,institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (meErr || !me?.institution_id) {
    return {
      ok: false as const,
      status: 400,
      error: "Aucune institution associée.",
    };
  }

  const { data: roleRow, error: roleErr } = await supa
    .from("user_roles")
    .select("role")
    .eq("profile_id", user.id)
    .eq("institution_id", me.institution_id)
    .maybeSingle();

  if (roleErr) {
    return { ok: false as const, status: 400, error: roleErr.message };
  }

  const role = String(roleRow?.role || "");
  if (!["admin", "super_admin"].includes(role)) {
    return { ok: false as const, status: 403, error: "Droits insuffisants." };
  }

  return {
    ok: true as const,
    admin_user_id: String(user.id),
    institution_id: String(me.institution_id),
  };
}

const SELECT_COLUMNS = `
  id,
  institution_id,
  teacher_user_id,
  teacher_profile_id,
  start_date,
  end_date,
  reason_code,
  reason_label,
  details,
  requested_days,
  signed,
  source,
  status,
  admin_comment,
  approved_at,
  approved_by,
  rejected_at,
  rejected_by,
  created_at,
  updated_at,
  lost_hours_total,
  lost_sessions_total,
  impact_summary,
  makeup_plan
`;

async function hydrateTeacherNames(
  institution_id: string,
  rows: any[]
): Promise<AdminAbsenceRequestItem[]> {
  const srv = getSupabaseServiceClient();

  const ids = Array.from(
    new Set((rows || []).map((r) => String(r.teacher_profile_id || "")).filter(Boolean))
  );

  if (ids.length === 0) {
    return (rows || []).map((row) => ({
      ...(row as any),
      teacher_name: null,
    }));
  }

  const { data: profiles } = await srv
    .from("profiles")
    .select("id,display_name,email")
    .eq("institution_id", institution_id)
    .in("id", ids);

  const nameById = new Map<string, string>();
  (profiles || []).forEach((p: any) => {
    nameById.set(String(p.id), String(p.display_name || p.email || ""));
  });

  return (rows || []).map((row) => ({
    ...(row as any),
    teacher_name: nameById.get(String(row.teacher_profile_id)) || null,
  }));
}

export async function GET(req: NextRequest) {
  const ctx = await getAdminContext();
  if (!ctx.ok) {
    return NextResponse.json({ ok: false, error: ctx.error }, { status: ctx.status });
  }

  const srv = getSupabaseServiceClient();
  const url = new URL(req.url);
  const status = String(url.searchParams.get("status") || "").trim();
  const teacher = String(url.searchParams.get("teacher") || "").trim().toLowerCase();

  let query = srv
    .from("teacher_absence_requests")
    .select(SELECT_COLUMNS)
    .eq("institution_id", ctx.institution_id)
    .order("created_at", { ascending: false });

  if (status && status !== "all") {
    query = query.eq("status", status);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 400 }
    );
  }

  let items = await hydrateTeacherNames(ctx.institution_id, data || []);

  if (teacher) {
    items = items.filter((item) =>
      String(item.teacher_name || "").toLowerCase().includes(teacher)
    );
  }

  return NextResponse.json({ ok: true, items });
}

export async function PATCH(req: NextRequest) {
  const ctx = await getAdminContext();
  if (!ctx.ok) {
    return NextResponse.json({ ok: false, error: ctx.error }, { status: ctx.status });
  }

  const srv = getSupabaseServiceClient();

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Payload JSON invalide." },
      { status: 400 }
    );
  }

  const id = String(body?.id || "").trim();
  const action = String(body?.action || "").trim() as ActionKind;
  const admin_comment = String(body?.admin_comment || "").trim() || null;

  if (!id) {
    return NextResponse.json(
      { ok: false, error: "Identifiant de demande manquant." },
      { status: 400 }
    );
  }

  if (!["approve", "reject"].includes(action)) {
    return NextResponse.json(
      { ok: false, error: "Action invalide." },
      { status: 400 }
    );
  }

  const nowIso = new Date().toISOString();

  const patch =
    action === "approve"
      ? {
          status: "approved",
          admin_comment,
          approved_at: nowIso,
          approved_by: ctx.admin_user_id,
          rejected_at: null,
          rejected_by: null,
        }
      : {
          status: "rejected",
          admin_comment,
          approved_at: null,
          approved_by: null,
          rejected_at: nowIso,
          rejected_by: ctx.admin_user_id,
        };

  const { data, error } = await srv
    .from("teacher_absence_requests")
    .update(patch)
    .eq("id", id)
    .eq("institution_id", ctx.institution_id)
    .select(SELECT_COLUMNS)
    .single();

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 400 }
    );
  }

  const [item] = await hydrateTeacherNames(ctx.institution_id, [data]);

  return NextResponse.json({
    ok: true,
    item,
    message:
      action === "approve"
        ? "La demande a été approuvée."
        : "La demande a été rejetée.",
  });
}
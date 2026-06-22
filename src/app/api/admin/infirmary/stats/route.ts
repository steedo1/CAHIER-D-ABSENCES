// src/app/api/admin/infirmary/stats/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RoleRow = {
  role: string | null;
  institution_id: string | null;
};

const ALLOWED_ROLES = new Set(["admin", "super_admin", "founder", "educator"]);
const CIV_TIME_ZONE = "Africa/Abidjan";

const REASON_LABELS: Record<string, string> = {
  malaise: "Malaise",
  douleur: "Douleur",
  blessure_legere: "Blessure légère",
  fatigue: "Fatigue",
  prise_traitement: "Prise de traitement",
  controle: "Contrôle",
  autre: "Autre",
};

function todayYmd() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: CIV_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function monthStartYmd(ymd: string) {
  return `${ymd.slice(0, 8)}01`;
}

function cleanYmd(value: unknown, fallback: string) {
  const s = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : fallback;
}

function inRangeYmd(value: unknown, start: string, end: string) {
  const ymd = String(value || "").slice(0, 10);
  return ymd >= start && ymd <= end;
}

function studentName(row: any) {
  const student = row?.students || {};
  return (
    `${student.last_name ?? ""} ${student.first_name ?? ""}`.trim() ||
    String(student.full_name || "").trim() ||
    "Élève"
  );
}

function roleMatchesInstitution(role: string, roleInstitutionId: unknown, institutionId: string) {
  if (role === "super_admin") return true;
  const roleInst = String(roleInstitutionId || "").trim();
  if (!roleInst) return Boolean(institutionId);
  return roleInst === institutionId;
}

async function requireInstitution() {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const {
    data: { user },
  } = await supa.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 }) };
  }

  const { data: me, error: meErr } = await supa
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (meErr) {
    return { error: NextResponse.json({ ok: false, error: meErr.message }, { status: 400 }) };
  }

  const { data: roleRows, error: roleErr } = await srv
    .from("user_roles")
    .select("role,institution_id")
    .eq("profile_id", user.id);

  if (roleErr) {
    return { error: NextResponse.json({ ok: false, error: roleErr.message }, { status: 400 }) };
  }

  const roles = ((roleRows || []) as RoleRow[]).filter((row) =>
    ALLOWED_ROLES.has(String(row.role || "")),
  );

  let institutionId = String((me as any)?.institution_id || "").trim();
  if (!institutionId) {
    const roleInstitution = roles.find((row) => row.institution_id)?.institution_id;
    institutionId = roleInstitution ? String(roleInstitution).trim() : "";
  }

  if (!institutionId) {
    return { error: NextResponse.json({ ok: false, error: "no_institution" }, { status: 400 }) };
  }

  const canUse = roles.some((row) =>
    roleMatchesInstitution(String(row.role || ""), row.institution_id, institutionId),
  );

  if (!canUse) {
    return { error: NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 }) };
  }

  return { srv, userId: user.id, institutionId };
}

export async function GET(req: NextRequest) {
  const ctx = await requireInstitution();
  if ("error" in ctx) return ctx.error;

  const { srv, institutionId } = ctx;
  const today = todayYmd();
  const url = new URL(req.url);
  const start = cleanYmd(url.searchParams.get("start"), monthStartYmd(today));
  const end = cleanYmd(url.searchParams.get("end"), today);

  const { data, error } = await srv
    .from("infirmary_visits")
    .select(
      `
      id,
      receipt_code,
      visit_date,
      entry_time,
      exit_time,
      duration_minutes,
      reason_category,
      condition_description,
      rest_start_date,
      rest_end_date,
      rest_days,
      status,
      parent_notified,
      notification_count,
      created_at,
      students:student_id ( id, first_name, last_name, full_name, matricule, photo_url ),
      classes:class_id ( id, label, level )
    `,
    )
    .eq("institution_id", institutionId)
    .gte("visit_date", start)
    .lte("visit_date", end)
    .order("visit_date", { ascending: false })
    .order("entry_time", { ascending: false })
    .limit(5000);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  const rows = data || [];
  const todayRows = rows.filter((row: any) => String(row.visit_date || "") === today);
  const openRows = rows.filter((row: any) => String(row.status || "") === "observation");
  const activeRestRows = rows.filter((row: any) =>
    row.rest_start_date && row.rest_end_date && inRangeYmd(today, String(row.rest_start_date), String(row.rest_end_date)),
  );
  const notifiedRows = rows.filter((row: any) => row.parent_notified === true || Number(row.notification_count || 0) > 0);
  const evacuatedRows = rows.filter((row: any) => String(row.status || "") === "evacue");

  const byReasonMap = new Map<string, number>();
  for (const row of rows as any[]) {
    const key = String(row.reason_category || "autre");
    byReasonMap.set(key, (byReasonMap.get(key) || 0) + 1);
  }

  const byReason = Array.from(byReasonMap.entries())
    .map(([key, count]) => ({ key, label: REASON_LABELS[key] || key, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const totalDuration = rows.reduce((sum: number, row: any) => sum + Number(row.duration_minutes || 0), 0);
  const averageDuration = rows.length ? Math.round(totalDuration / rows.length) : 0;

  const recent = rows.slice(0, 10).map((row: any) => ({
    id: row.id,
    receipt_code: row.receipt_code,
    visit_date: row.visit_date,
    entry_time: row.entry_time,
    exit_time: row.exit_time,
    duration_minutes: row.duration_minutes,
    reason_category: row.reason_category,
    condition_description: row.condition_description,
    rest_start_date: row.rest_start_date,
    rest_end_date: row.rest_end_date,
    rest_days: row.rest_days,
    status: row.status,
    parent_notified: row.parent_notified,
    student_name: studentName(row),
    class_label: row?.classes?.label || null,
  }));

  return NextResponse.json({
    ok: true,
    period: { start, end, today },
    totals: {
      visits: rows.length,
      today: todayRows.length,
      open: openRows.length,
      active_rest: activeRestRows.length,
      notified: notifiedRows.length,
      evacuated: evacuatedRows.length,
      average_duration_minutes: averageDuration,
    },
    by_reason: byReason,
    recent,
  });
}

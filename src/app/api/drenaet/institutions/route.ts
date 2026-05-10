// src/app/api/drenaet/institutions/route.ts
import { NextRequest, NextResponse } from "next/server";
import { guardDrenaetScope, groupCount, normalizeDirection, todayRangeUTC } from "../_helpers/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function pct(part: number, total: number) {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10;
}

export async function GET(req: NextRequest) {
  const g = await guardDrenaetScope();
  if ("error" in g) return g.error;

  const url = new URL(req.url);
  const q = String(url.searchParams.get("q") || "").trim().toLowerCase();
  const status = String(url.searchParams.get("status") || "").trim();
  const { fromISO, toISO } = todayRangeUTC();
  const ids = g.institutionIds;

  if (!ids.length) {
    return NextResponse.json({ ok: true, items: [], total: 0 });
  }

  const [studentsQ, teachersQ, marksQ, sessionsQ] = await Promise.all([
    g.srv.from("students").select("id,institution_id").in("institution_id", ids).range(0, 50000),
    g.srv
      .from("user_roles")
      .select("profile_id,institution_id")
      .eq("role", "teacher")
      .in("institution_id", ids)
      .range(0, 50000),
    g.srv
      .from("v_mark_minutes")
      .select("institution_id,status,started_at")
      .in("institution_id", ids)
      .gte("started_at", fromISO)
      .lt("started_at", toISO)
      .range(0, 50000),
    g.srv
      .from("teacher_sessions")
      .select("id,institution_id,actual_call_at,ended_at,started_at")
      .in("institution_id", ids)
      .gte("started_at", fromISO)
      .lt("started_at", toISO)
      .range(0, 50000),
  ]);

  const studentsByInstitution = groupCount((studentsQ.data || []) as any[], "institution_id");
  const teachersByInstitution = groupCount((teachersQ.data || []) as any[], "institution_id");

  const marks = (marksQ.data || []) as any[];
  const sessions = (sessionsQ.data || []) as any[];

  const absencesByInstitution = new Map<string, number>();
  const retardsByInstitution = new Map<string, number>();
  for (const m of marks) {
    const institutionId = String(m.institution_id || "");
    if (!institutionId) continue;
    if (m.status === "absent") absencesByInstitution.set(institutionId, (absencesByInstitution.get(institutionId) || 0) + 1);
    if (m.status === "late") retardsByInstitution.set(institutionId, (retardsByInstitution.get(institutionId) || 0) + 1);
  }

  const sessionsByInstitution = groupCount(sessions, "institution_id");
  const callsByInstitution = new Map<string, number>();
  for (const s of sessions) {
    const institutionId = String(s.institution_id || "");
    if (!institutionId || !s.actual_call_at) continue;
    callsByInstitution.set(institutionId, (callsByInstitution.get(institutionId) || 0) + 1);
  }

  let items = g.institutions.map((inst) => {
    const sessionsToday = sessionsByInstitution.get(inst.id) || 0;
    const callsToday = callsByInstitution.get(inst.id) || 0;
    const absencesToday = absencesByInstitution.get(inst.id) || 0;
    const retardsToday = retardsByInstitution.get(inst.id) || 0;
    const activityScore = sessionsToday + absencesToday + retardsToday;

    let state: "normal" | "watch" | "alert" | "silent" = "normal";
    if (activityScore === 0) state = "silent";
    else if (sessionsToday > 0 && pct(callsToday, sessionsToday) < 60) state = "alert";
    else if (absencesToday >= 30 || retardsToday >= 20) state = "watch";

    return {
      id: inst.id,
      name: inst.name || "Établissement sans nom",
      code_unique: inst.code_unique || "",
      code: inst.code || "",
      regional_direction: normalizeDirection(inst.regional_direction),
      status: inst.status || "",
      students: studentsByInstitution.get(inst.id) || 0,
      teachers: teachersByInstitution.get(inst.id) || 0,
      sessions_today: sessionsToday,
      calls_today: callsToday,
      teacher_coverage_rate: pct(callsToday, sessionsToday),
      absences_today: absencesToday,
      retards_today: retardsToday,
      state,
    };
  });

  if (q) {
    items = items.filter((i) =>
      [i.name, i.code_unique, i.code, i.regional_direction].join(" ").toLowerCase().includes(q)
    );
  }
  if (status) {
    items = items.filter((i) => i.state === status);
  }

  return NextResponse.json({
    ok: true,
    total: items.length,
    items,
    warnings: {
      students: studentsQ.error?.message || null,
      teachers: teachersQ.error?.message || null,
      marks: marksQ.error?.message || null,
      sessions: sessionsQ.error?.message || null,
    },
  });
}

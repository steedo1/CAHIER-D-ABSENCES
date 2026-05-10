// src/app/api/drenaet/dashboard/route.ts
import { NextResponse } from "next/server";
import { guardDrenaetScope, groupCount, todayRangeUTC } from "../_helpers/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function rate(part: number, total: number) {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10;
}

export async function GET() {
  const g = await guardDrenaetScope();
  if ("error" in g) return g.error;

  const { fromISO, toISO, today } = todayRangeUTC();
  const ids = g.institutionIds;

  if (!ids.length) {
    return NextResponse.json({
      ok: true,
      scope: {
        role: g.role,
        regional_directions: g.regionalDirections,
        institutions: 0,
      },
      counts: { institutions: 0, students: 0, teachers: 0 },
      today: { date: today, absences: 0, retards: 0, sessions: 0, sessions_with_call: 0, sessions_closed: 0, teacher_coverage_rate: 0 },
      alerts: [],
      institutions: [],
    });
  }

  const [studentsQ, teachersQ, marksQ, sessionsQ] = await Promise.all([
    g.srv.from("students").select("id", { count: "exact", head: true }).in("institution_id", ids),
    g.srv
      .from("user_roles")
      .select("profile_id", { count: "exact", head: true })
      .eq("role", "teacher")
      .in("institution_id", ids),
    g.srv
      .from("v_mark_minutes")
      .select("institution_id,status,started_at")
      .in("institution_id", ids)
      .gte("started_at", fromISO)
      .lt("started_at", toISO)
      .range(0, 20000),
    g.srv
      .from("teacher_sessions")
      .select("id,institution_id,started_at,actual_call_at,ended_at")
      .in("institution_id", ids)
      .gte("started_at", fromISO)
      .lt("started_at", toISO)
      .range(0, 20000),
  ]);

  const marks = marksQ.error ? [] : marksQ.data || [];
  const sessions = sessionsQ.error ? [] : sessionsQ.data || [];

  const absences = marks.filter((m: any) => String(m.status) === "absent").length;
  const retards = marks.filter((m: any) => String(m.status) === "late").length;
  const sessionsWithCall = sessions.filter((s: any) => Boolean(s.actual_call_at)).length;
  const sessionsClosed = sessions.filter((s: any) => Boolean(s.ended_at)).length;

  const marksByInstitution = groupCount(marks as any[], "institution_id");
  const sessionsByInstitution = groupCount(sessions as any[], "institution_id");

  const institutionCards = g.institutions.map((inst) => {
    const sessionCount = sessionsByInstitution.get(inst.id) || 0;
    const markCount = marksByInstitution.get(inst.id) || 0;
    return {
      id: inst.id,
      name: inst.name || "Établissement sans nom",
      code_unique: inst.code_unique,
      regional_direction: inst.regional_direction,
      status: inst.status,
      activity_score: sessionCount + markCount,
      sessions_today: sessionCount,
      marks_today: markCount,
    };
  });

  const silent = institutionCards.filter((i) => i.activity_score === 0);
  const alertCards = [...institutionCards]
    .sort((a, b) => a.activity_score - b.activity_score)
    .slice(0, 8);

  const alerts = [];
  if (silent.length) {
    alerts.push({
      level: "critical",
      title: "Établissements sans donnée aujourd’hui",
      message: `${silent.length} établissement(s) n'ont transmis aucune activité aujourd'hui.`,
      count: silent.length,
    });
  }
  if (sessions.length > 0 && rate(sessionsWithCall, sessions.length) < 70) {
    alerts.push({
      level: "warning",
      title: "Présence enseignants à surveiller",
      message: `Seulement ${rate(sessionsWithCall, sessions.length)}% des séances enregistrées ont un appel confirmé aujourd'hui.`,
      count: sessions.length - sessionsWithCall,
    });
  }
  if (absences > 0) {
    alerts.push({
      level: "info",
      title: "Absences élèves du jour",
      message: `${absences} absence(s) élève(s) enregistrée(s) aujourd'hui dans le périmètre régional.`,
      count: absences,
    });
  }

  return NextResponse.json({
    ok: true,
    scope: {
      role: g.role,
      regional_directions: g.regionalDirections,
      institutions: g.institutions.length,
    },
    counts: {
      institutions: g.institutions.length,
      students: studentsQ.error ? 0 : studentsQ.count || 0,
      teachers: teachersQ.error ? 0 : teachersQ.count || 0,
    },
    today: {
      date: today,
      absences,
      retards,
      sessions: sessions.length,
      sessions_with_call: sessionsWithCall,
      sessions_closed: sessionsClosed,
      teacher_coverage_rate: rate(sessionsWithCall, sessions.length),
    },
    alerts,
    institutions: alertCards,
    warnings: {
      students: studentsQ.error?.message || null,
      teachers: teachersQ.error?.message || null,
      marks: marksQ.error?.message || null,
      sessions: sessionsQ.error?.message || null,
    },
  });
}

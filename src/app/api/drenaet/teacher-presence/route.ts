// src/app/api/drenaet/teacher-presence/route.ts
import { NextRequest, NextResponse } from "next/server";
import { dayRangeFromSearchParams, guardDrenaetScope } from "../_helpers/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function pct(part: number, total: number) {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10;
}

export async function GET(req: NextRequest) {
  const g = await guardDrenaetScope();
  if ("error" in g) return g.error;

  if (!g.canViewTeacherPresence && !g.isSuper) {
    return NextResponse.json({ error: "forbidden_teacher_presence" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const range = dayRangeFromSearchParams(searchParams);
  const ids = g.institutionIds;

  if (!ids.length) {
    return NextResponse.json({ ok: true, range, totals: { sessions: 0, confirmed: 0, closed: 0, coverage_rate: 0 }, items: [] });
  }

  const { data, error } = await g.srv
    .from("teacher_sessions")
    .select("id,institution_id,teacher_id,started_at,actual_call_at,ended_at,origin,expected_minutes")
    .in("institution_id", ids)
    .gte("started_at", range.fromISO)
    .lt("started_at", range.toISO)
    .range(0, 80000);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const rows = (data || []) as any[];
  const byInstitution = new Map<string, { sessions: number; confirmed: number; closed: number; teachers: Set<string> }>();

  for (const row of rows) {
    const id = String(row.institution_id || "");
    if (!id) continue;
    const current = byInstitution.get(id) || { sessions: 0, confirmed: 0, closed: 0, teachers: new Set<string>() };
    current.sessions += 1;
    if (row.actual_call_at) current.confirmed += 1;
    if (row.ended_at) current.closed += 1;
    if (row.teacher_id) current.teachers.add(String(row.teacher_id));
    byInstitution.set(id, current);
  }

  const items = g.institutions.map((inst) => {
    const v = byInstitution.get(inst.id) || { sessions: 0, confirmed: 0, closed: 0, teachers: new Set<string>() };
    return {
      institution_id: inst.id,
      institution_name: inst.name || "Établissement sans nom",
      regional_direction: inst.regional_direction || "",
      sessions: v.sessions,
      confirmed: v.confirmed,
      closed: v.closed,
      missing: Math.max(0, v.sessions - v.confirmed),
      teachers_seen: v.teachers.size,
      coverage_rate: pct(v.confirmed, v.sessions),
      close_rate: pct(v.closed, v.sessions),
    };
  }).sort((a, b) => a.coverage_rate - b.coverage_rate);

  const totalsRaw = items.reduce(
    (acc, item) => {
      acc.sessions += item.sessions;
      acc.confirmed += item.confirmed;
      acc.closed += item.closed;
      acc.missing += item.missing;
      return acc;
    },
    { sessions: 0, confirmed: 0, closed: 0, missing: 0 }
  );

  return NextResponse.json({
    ok: true,
    range,
    totals: {
      ...totalsRaw,
      coverage_rate: pct(totalsRaw.confirmed, totalsRaw.sessions),
      close_rate: pct(totalsRaw.closed, totalsRaw.sessions),
    },
    items,
  });
}

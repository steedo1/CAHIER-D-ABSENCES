// src/app/api/drenaet/attendance/route.ts
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

  const { searchParams } = new URL(req.url);
  const range = dayRangeFromSearchParams(searchParams);
  const ids = g.institutionIds;

  if (!ids.length) {
    return NextResponse.json({ ok: true, range, totals: { absences: 0, retards: 0, marks: 0 }, items: [] });
  }

  const { data, error } = await g.srv
    .from("v_mark_minutes")
    .select("id,institution_id,status,started_at,class_id,student_id,minutes_late")
    .in("institution_id", ids)
    .gte("started_at", range.fromISO)
    .lt("started_at", range.toISO)
    .range(0, 80000);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const rows = (data || []) as any[];
  const byInstitution = new Map<string, { marks: number; absences: number; retards: number; lateMinutes: number }>();

  for (const row of rows) {
    const id = String(row.institution_id || "");
    if (!id) continue;
    const current = byInstitution.get(id) || { marks: 0, absences: 0, retards: 0, lateMinutes: 0 };
    current.marks += 1;
    if (row.status === "absent") current.absences += 1;
    if (row.status === "late") {
      current.retards += 1;
      current.lateMinutes += Number(row.minutes_late || 0);
    }
    byInstitution.set(id, current);
  }

  const items = g.institutions.map((inst) => {
    const v = byInstitution.get(inst.id) || { marks: 0, absences: 0, retards: 0, lateMinutes: 0 };
    return {
      institution_id: inst.id,
      institution_name: inst.name || "Établissement sans nom",
      regional_direction: inst.regional_direction || "",
      marks: v.marks,
      absences: v.absences,
      retards: v.retards,
      late_minutes: v.lateMinutes,
      absence_rate: pct(v.absences, v.marks),
      late_rate: pct(v.retards, v.marks),
    };
  }).sort((a, b) => (b.absences + b.retards) - (a.absences + a.retards));

  const totals = items.reduce(
    (acc, item) => {
      acc.marks += item.marks;
      acc.absences += item.absences;
      acc.retards += item.retards;
      acc.late_minutes += item.late_minutes;
      return acc;
    },
    { marks: 0, absences: 0, retards: 0, late_minutes: 0 }
  );

  return NextResponse.json({
    ok: true,
    range,
    totals: {
      ...totals,
      absence_rate: pct(totals.absences, totals.marks),
      late_rate: pct(totals.retards, totals.marks),
    },
    items,
  });
}

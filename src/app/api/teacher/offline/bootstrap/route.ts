import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RawAssignment = {
  class_id: string;
  subject_id: string | null;
  classes: {
    label?: string | null;
    level?: string | null;
    institution_id?: string | null;
  } | null;
};

type TimetableRow = {
  institution_id?: string | null;
  class_id?: string | null;
  subject_id?: string | null;
  period_id?: string | null;
};

type PeriodRow = {
  id?: string | null;
  institution_id?: string | null;
  weekday?: number | null;
  label?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  period_no?: number | null;
};

type SubjectLookup = {
  instSubjectId: string | null;
  canonicalSubjectId: string | null;
  subjectName: string | null;
};

type ClassItem = {
  class_id: string;
  class_label: string;
  level: string;
  subject_id: string | null;
  subject_name: string | null;
};

function uniqStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(values.map((value) => String(value || "").trim()).filter(Boolean))
  );
}

function normalizeWeekday(value: unknown): number {
  const weekday = Number(value);
  if (weekday === 0) return 7;
  return Number.isFinite(weekday) && weekday >= 1 && weekday <= 7 ? weekday : 1;
}

function hm(value: unknown, fallback: string): string {
  const text = String(value || fallback).slice(0, 5);
  return /^\d{2}:\d{2}$/.test(text) ? text : fallback;
}

async function buildSubjectLookup(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  ids: Array<string | null | undefined>
): Promise<Map<string, SubjectLookup>> {
  const map = new Map<string, SubjectLookup>();
  const uniqueIds = uniqStrings(ids);
  if (!uniqueIds.length) return map;

  const orExpr = uniqueIds
    .flatMap((id) => [`id.eq.${id}`, `subject_id.eq.${id}`])
    .join(",");

  const { data, error } = await srv
    .from("institution_subjects")
    .select("id,subject_id,custom_name,subjects:subject_id(id,name)")
    .or(orExpr);

  if (error) throw error;

  for (const row of (data || []) as any[]) {
    const instSubjectId = String(row?.id || "").trim() || null;
    const canonicalSubjectId =
      String(row?.subjects?.id || row?.subject_id || instSubjectId || "").trim() || null;
    const subjectName = String(row?.custom_name || row?.subjects?.name || "").trim() || null;
    const lookup: SubjectLookup = { instSubjectId, canonicalSubjectId, subjectName };

    for (const key of uniqStrings([instSubjectId, row?.subject_id, canonicalSubjectId])) {
      map.set(key, lookup);
    }
  }

  return map;
}

function subjectTokens(
  subjectId: string | null | undefined,
  lookup: Map<string, SubjectLookup>
): string[] {
  const raw = String(subjectId || "").trim();
  if (!raw) return [];
  const ref = lookup.get(raw);
  return ref
    ? uniqStrings([raw, ref.instSubjectId, ref.canonicalSubjectId])
    : [raw];
}

function dedupeItems(items: ClassItem[]): ClassItem[] {
  const map = new Map<string, ClassItem>();
  for (const item of items) {
    map.set(`${item.class_id}|${item.subject_id || ""}`, item);
  }
  return Array.from(map.values()).sort((a, b) => {
    const byClass = a.class_label.localeCompare(b.class_label, "fr", { numeric: true });
    return byClass || String(a.subject_name || "").localeCompare(String(b.subject_name || ""), "fr");
  });
}

function noStoreJson(body: unknown, status = 200) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}

export async function GET() {
  try {
    const supa = await getSupabaseServerClient();
    const srv = getSupabaseServiceClient();
    const {
      data: { user },
    } = await supa.auth.getUser();

    if (!user) return noStoreJson({ error: "unauthorized" }, 401);

    const { data: assignmentData, error: assignmentError } = await srv
      .from("class_teachers")
      .select("class_id,subject_id,classes:class_id(label,level,institution_id)")
      .eq("teacher_id", user.id);

    if (assignmentError) return noStoreJson({ error: assignmentError.message }, 400);

    const assignments = ((assignmentData || []) as any[]).filter(
      (row) => row?.class_id && row?.classes?.institution_id
    ) as RawAssignment[];

    if (!assignments.length) {
      return noStoreJson({
        version: 1,
        generated_at: new Date().toISOString(),
        slots: [],
        class_count: 0,
        slot_count: 0,
      });
    }

    const institutionIds = uniqStrings(
      assignments.map((row) => row.classes?.institution_id || null)
    );

    const [periodResult, timetableResult] = await Promise.all([
      srv
        .from("institution_periods")
        .select("id,institution_id,weekday,label,start_time,end_time,period_no")
        .in("institution_id", institutionIds)
        .order("weekday", { ascending: true })
        .order("period_no", { ascending: true }),
      srv
        .from("teacher_timetables")
        .select("institution_id,class_id,subject_id,period_id")
        .eq("teacher_id", user.id)
        .in("institution_id", institutionIds),
    ]);

    if (periodResult.error) return noStoreJson({ error: periodResult.error.message }, 400);
    if (timetableResult.error) return noStoreJson({ error: timetableResult.error.message }, 400);

    const periods = ((periodResult.data || []) as any[]).filter(Boolean) as PeriodRow[];
    const timetables = ((timetableResult.data || []) as any[]).filter(Boolean) as TimetableRow[];
    const lookup = await buildSubjectLookup(srv, [
      ...assignments.map((row) => row.subject_id),
      ...timetables.map((row) => row.subject_id),
    ]);

    const periodById = new Map(
      periods
        .map((period) => [String(period.id || "").trim(), period] as const)
        .filter(([id]) => Boolean(id))
    );
    const assignmentsByClass = new Map<string, RawAssignment[]>();
    for (const assignment of assignments) {
      const list = assignmentsByClass.get(assignment.class_id) || [];
      list.push(assignment);
      assignmentsByClass.set(assignment.class_id, list);
    }

    const grouped = new Map<
      string,
      { key: string; weekday: number; label: string; start_time: string; end_time: string; items: ClassItem[] }
    >();

    for (const timetable of timetables) {
      const period = periodById.get(String(timetable.period_id || "").trim());
      const classId = String(timetable.class_id || "").trim();
      if (!period || !classId) continue;

      const candidates = assignmentsByClass.get(classId) || [];
      const timetableTokens = subjectTokens(timetable.subject_id, lookup);
      const assignment = candidates.find((candidate) => {
        const candidateInstitution = String(candidate.classes?.institution_id || "").trim();
        if (candidateInstitution !== String(timetable.institution_id || "").trim()) return false;
        const assignmentTokens = subjectTokens(candidate.subject_id, lookup);
        if (!assignmentTokens.length || !timetableTokens.length) return true;
        return assignmentTokens.some((token) => timetableTokens.includes(token));
      });
      if (!assignment?.classes) continue;

      const rawSubjectId = String(timetable.subject_id || assignment.subject_id || "").trim() || null;
      const subject = rawSubjectId ? lookup.get(rawSubjectId) : null;
      const weekday = normalizeWeekday(period.weekday);
      const startTime = hm(period.start_time, "08:00");
      const endTime = hm(period.end_time, "09:00");
      const key = `${weekday}|${startTime}|${endTime}`;

      if (!grouped.has(key)) {
        grouped.set(key, {
          key,
          weekday,
          label: String(period.label || "Séance"),
          start_time: startTime,
          end_time: endTime,
          items: [],
        });
      }

      grouped.get(key)!.items.push({
        class_id: classId,
        class_label: String(assignment.classes.label || "Classe"),
        level: String(assignment.classes.level || ""),
        subject_id: subject?.canonicalSubjectId || rawSubjectId,
        subject_name: subject?.subjectName || null,
      });
    }

    const slots = Array.from(grouped.values())
      .map((slot) => ({ ...slot, items: dedupeItems(slot.items) }))
      .sort((a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time));
    const classIds = new Set(slots.flatMap((slot) => slot.items.map((item) => item.class_id)));

    return noStoreJson({
      version: 1,
      generated_at: new Date().toISOString(),
      slots,
      class_count: classIds.size,
      slot_count: slots.length,
    });
  } catch (error: any) {
    return noStoreJson({ error: error?.message || "teacher_offline_bootstrap_failed" }, 500);
  }
}

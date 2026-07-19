import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

type ClassRow = {
  id?: string | null;
  institution_id?: string | null;
  label?: string | null;
  level?: string | null;
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
    new Set(values.map((value) => String(value || "").trim()).filter(Boolean)),
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
  ids: Array<string | null | undefined>,
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
    const subject = Array.isArray(row?.subjects)
      ? row.subjects[0] || {}
      : row?.subjects || {};
    const canonicalSubjectId =
      String(subject?.id || row?.subject_id || instSubjectId || "").trim() || null;
    const subjectName =
      String(row?.custom_name || subject?.name || "").trim() || null;
    const lookup: SubjectLookup = {
      instSubjectId,
      canonicalSubjectId,
      subjectName,
    };

    for (const key of uniqStrings([
      instSubjectId,
      row?.subject_id ? String(row.subject_id) : null,
      canonicalSubjectId,
    ])) {
      map.set(key, lookup);
    }
  }

  return map;
}

function dedupeItems(items: ClassItem[]): ClassItem[] {
  const map = new Map<string, ClassItem>();
  for (const item of items) {
    map.set(`${item.class_id}|${item.subject_id || ""}`, item);
  }
  return Array.from(map.values()).sort((a, b) => {
    const byClass = a.class_label.localeCompare(b.class_label, "fr", {
      numeric: true,
    });
    return (
      byClass ||
      String(a.subject_name || "").localeCompare(
        String(b.subject_name || ""),
        "fr",
      )
    );
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

    const { data: profile, error: profileError } = await srv
      .from("profiles")
      .select("institution_id")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) return noStoreJson({ error: profileError.message }, 400);

    const institutionId = String(profile?.institution_id || "").trim();
    if (!institutionId) {
      return noStoreJson({
        version: 1,
        generated_at: new Date().toISOString(),
        source: "teacher_timetables",
        slots: [],
        class_count: 0,
        slot_count: 0,
      });
    }

    const [periodResult, timetableResult, classResult] = await Promise.all([
      srv
        .from("institution_periods")
        .select("id,institution_id,weekday,label,start_time,end_time,period_no")
        .eq("institution_id", institutionId)
        .order("weekday", { ascending: true })
        .order("period_no", { ascending: true }),
      srv
        .from("teacher_timetables")
        .select("institution_id,class_id,subject_id,period_id")
        .eq("teacher_id", user.id)
        .eq("institution_id", institutionId),
      srv
        .from("classes")
        .select("id,institution_id,label,level")
        .eq("institution_id", institutionId),
    ]);

    if (periodResult.error) {
      return noStoreJson({ error: periodResult.error.message }, 400);
    }
    if (timetableResult.error) {
      return noStoreJson({ error: timetableResult.error.message }, 400);
    }
    if (classResult.error) {
      return noStoreJson({ error: classResult.error.message }, 400);
    }

    const periods = ((periodResult.data || []) as any[]).filter(Boolean) as PeriodRow[];
    const timetables = ((timetableResult.data || []) as any[]).filter(
      (row) => row?.class_id && row?.period_id,
    ) as TimetableRow[];
    const classes = ((classResult.data || []) as any[]).filter(Boolean) as ClassRow[];

    const subjectLookup = await buildSubjectLookup(
      srv,
      timetables.map((row) => row.subject_id),
    );

    const periodById = new Map(
      periods
        .map((period) => [String(period.id || "").trim(), period] as const)
        .filter(([id]) => Boolean(id)),
    );
    const classById = new Map(
      classes
        .map((classRow) => [String(classRow.id || "").trim(), classRow] as const)
        .filter(([id]) => Boolean(id)),
    );

    const grouped = new Map<
      string,
      {
        key: string;
        weekday: number;
        label: string;
        start_time: string;
        end_time: string;
        items: ClassItem[];
      }
    >();

    for (const timetable of timetables) {
      const period = periodById.get(String(timetable.period_id || "").trim());
      const classId = String(timetable.class_id || "").trim();
      const classRow = classById.get(classId);
      if (!period || !classId || !classRow) continue;

      if (
        String(timetable.institution_id || "").trim() !== institutionId ||
        String(classRow.institution_id || "").trim() !== institutionId
      ) {
        continue;
      }

      const rawSubjectId = String(timetable.subject_id || "").trim() || null;
      const subject = rawSubjectId ? subjectLookup.get(rawSubjectId) : null;
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
        class_label: String(classRow.label || "Classe"),
        level: String(classRow.level || ""),
        subject_id: subject?.canonicalSubjectId || rawSubjectId,
        subject_name: subject?.subjectName || null,
      });
    }

    const slots = Array.from(grouped.values())
      .map((slot) => ({ ...slot, items: dedupeItems(slot.items) }))
      .sort(
        (a, b) =>
          a.weekday - b.weekday || a.start_time.localeCompare(b.start_time),
      );
    const classIds = new Set(
      slots.flatMap((slot) => slot.items.map((item) => item.class_id)),
    );

    return noStoreJson({
      version: 1,
      generated_at: new Date().toISOString(),
      source: "teacher_timetables",
      slots,
      class_count: classIds.size,
      slot_count: slots.length,
    });
  } catch (error: any) {
    return noStoreJson(
      { error: error?.message || "teacher_offline_bootstrap_failed" },
      500,
    );
  }
}

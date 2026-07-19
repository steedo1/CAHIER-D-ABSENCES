// src/app/api/teacher/classes/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ItemOut = {
  class_id: string;
  class_label: string;
  level: string;
  subject_id: string | null;
  subject_name: string | null;
};

type TimetableRow = {
  institution_id?: string | null;
  class_id?: string | null;
  subject_id?: string | null;
  period_id?: string | null;
};

type SubjectLookup = {
  instSubjectId: string | null;
  canonicalSubjectId: string | null;
  subjectName: string | null;
};

function uniqStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => String(value || "").trim())
        .filter((value) => value.length > 0),
    ),
  );
}

function hmsToMin(hms: string | null | undefined) {
  const value = String(hms || "00:00:00").slice(0, 8);
  const [hours, minutes] = value.split(":").map((part) => parseInt(part, 10));
  return (Number.isFinite(hours) ? hours : 0) * 60 +
    (Number.isFinite(minutes) ? minutes : 0);
}

function hmInTZ(date: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function weekdayInTZ1to7(date: Date, tz: string): number {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
  })
    .format(date)
    .toLowerCase();

  const map: Record<string, number> = {
    sun: 7,
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6,
  };

  return map[weekday] ?? 7;
}

async function buildSubjectLookup(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  ids: Array<string | null | undefined>,
): Promise<Map<string, SubjectLookup>> {
  const lookup = new Map<string, SubjectLookup>();
  const uniqueIds = uniqStrings(ids);
  if (!uniqueIds.length) return lookup;

  const orExpression = uniqueIds
    .flatMap((id) => [`id.eq.${id}`, `subject_id.eq.${id}`])
    .join(",");

  const { data, error } = await srv
    .from("institution_subjects")
    .select("id,subject_id,custom_name,subjects:subject_id(id,name)")
    .or(orExpression);

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

    const value: SubjectLookup = {
      instSubjectId,
      canonicalSubjectId,
      subjectName,
    };

    for (const key of uniqStrings([
      instSubjectId,
      row?.subject_id ? String(row.subject_id) : null,
      canonicalSubjectId,
    ])) {
      lookup.set(key, value);
    }
  }

  return lookup;
}

function dedupeAndSort(items: ItemOut[]): ItemOut[] {
  const seen = new Set<string>();

  return items
    .filter((item) => {
      const key = `${item.class_id}|${item.subject_id || ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
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

    if (!user) {
      return noStoreJson({ error: "unauthorized" }, 401);
    }

    const { data: profile, error: profileError } = await srv
      .from("profiles")
      .select("institution_id")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      return noStoreJson({ error: profileError.message }, 400);
    }

    const institutionId = String(profile?.institution_id || "").trim();
    if (!institutionId) {
      return noStoreJson({ items: [], source: "teacher_timetables" });
    }

    const { data: institution, error: institutionError } = await srv
      .from("institutions")
      .select("id,tz")
      .eq("id", institutionId)
      .maybeSingle();

    if (institutionError) {
      return noStoreJson({ error: institutionError.message }, 400);
    }

    const tz = String(institution?.tz || "Africa/Abidjan");
    const now = new Date();
    const isoWeekday = weekdayInTZ1to7(now, tz);
    const weekdayValues = uniqStrings([
      String(isoWeekday),
      isoWeekday === 7 ? "0" : String(isoWeekday),
    ]).map(Number);
    const nowMinutes = hmsToMin(`${hmInTZ(now, tz)}:00`);

    const { data: periods, error: periodsError } = await srv
      .from("institution_periods")
      .select("id,start_time,end_time,period_no")
      .eq("institution_id", institutionId)
      .in("weekday", weekdayValues)
      .order("period_no", { ascending: true });

    if (periodsError) {
      return noStoreJson({ error: periodsError.message }, 400);
    }

    const activePeriod = ((periods || []) as any[]).find((period) => {
      const start = hmsToMin(period?.start_time);
      const end = hmsToMin(period?.end_time);
      return nowMinutes >= start && nowMinutes < end;
    });

    if (!activePeriod?.id) {
      return noStoreJson({ items: [], source: "teacher_timetables" });
    }

    const { data: timetableData, error: timetableError } = await srv
      .from("teacher_timetables")
      .select("institution_id,class_id,subject_id,period_id")
      .eq("institution_id", institutionId)
      .eq("teacher_id", user.id)
      .eq("period_id", String(activePeriod.id));

    if (timetableError) {
      return noStoreJson({ error: timetableError.message }, 400);
    }

    const timetables = ((timetableData || []) as any[]).filter(
      (row) => row?.class_id,
    ) as TimetableRow[];

    if (!timetables.length) {
      return noStoreJson({ items: [], source: "teacher_timetables" });
    }

    const classIds = uniqStrings(timetables.map((row) => row.class_id));
    const { data: classes, error: classesError } = await srv
      .from("classes")
      .select("id,label,level,institution_id")
      .eq("institution_id", institutionId)
      .in("id", classIds);

    if (classesError) {
      return noStoreJson({ error: classesError.message }, 400);
    }

    const classById = new Map(
      ((classes || []) as any[]).map((row) => [String(row.id), row]),
    );
    const subjectLookup = await buildSubjectLookup(
      srv,
      timetables.map((row) => row.subject_id),
    );

    const items = timetables
      .map((row): ItemOut | null => {
        const classId = String(row.class_id || "").trim();
        const classRow = classById.get(classId);
        if (!classRow) return null;

        const rawSubjectId = String(row.subject_id || "").trim() || null;
        const subject = rawSubjectId ? subjectLookup.get(rawSubjectId) : null;

        return {
          class_id: classId,
          class_label: String(classRow.label || "Classe"),
          level: String(classRow.level || ""),
          subject_id: subject?.canonicalSubjectId || rawSubjectId,
          subject_name: subject?.subjectName || null,
        };
      })
      .filter((item): item is ItemOut => Boolean(item));

    return noStoreJson({
      items: dedupeAndSort(items),
      source: "teacher_timetables",
      period_id: String(activePeriod.id),
    });
  } catch (error: any) {
    return noStoreJson(
      { error: error?.message || "classes_failed" },
      500,
    );
  }
}

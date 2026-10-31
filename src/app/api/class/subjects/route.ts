// src/app/api/class/subjects/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import {
  attendanceClassContextIsComplete,
  isNonGeneralAttendanceEducation,
} from "@/lib/education-attendance";
import { classDeviceMayAccessClass } from "@/lib/class-device-identity";
import { readAttendanceScheduleRevision, readAttendancePreparationSnapshot, attendancePreparationSnapshotsMatch } from "@/lib/attendance-schedule-revision-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SubjectItem = {
  id: string; // institution_subjects.id si possible, sinon subjects.id
  label: string;
};

type SlotSpec = {
  weekday: number; // 1..7 (ISO ; 7 = dimanche)
  startHM: string;
  endHM: string;
};

type TimetableSubjectRow = {
  id?: string | null;
  subject_id?: string | null;
  updated_at?: string | null;
};

function currentTimetableSubjectIds(rows: TimetableSubjectRow[]): string[] {
  // Several subjects can legitimately coexist in the same class/period
  // (for example German + Spanish language groups). The timetable table is
  // the source of truth here, so preserve every distinct scheduled subject
  // instead of arbitrarily choosing the most recently updated row.
  return Array.from(
    new Set(
      (rows || [])
        .map((row) => String(row?.subject_id || "").trim())
        .filter(Boolean),
    ),
  );
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set((arr || []).filter(Boolean))) as T[];
}

function hmsToMin(hms: string | null | undefined) {
  const s = String(hms || "00:00:00").slice(0, 8);
  const [h, m] = s.split(":").map((n) => parseInt(n, 10));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

function hmInTZ(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

function weekdayInTZ1to7(d: Date, tz: string): number {
  const w = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
  })
    .format(d)
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

  return map[w] ?? 7;
}

function parseSlot(slotRaw: string | null): SlotSpec | null {
  const slot = String(slotRaw || "").trim();
  if (!slot) return null;
  if (slot.startsWith("closed|")) return null;
  if (slot.startsWith("no-config|")) return null;

  const m = slot.match(/^(\d{1,2})\|(\d{2}:\d{2})\|(\d{2}:\d{2})$/);
  if (!m) return null;

  const weekday = Number(m[1]);
  if (!Number.isFinite(weekday) || weekday < 1 || weekday > 7) return null;

  return {
    weekday,
    startHM: m[2],
    endHM: m[3],
  };
}

async function resolveAutoPeriodIds(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string,
  tz: string,
  slotRaw: string | null,
  periodIdRaw: string | null = null
): Promise<string[]> {
  const parsed = parseSlot(slotRaw);
  const requestedPeriodId = String(periodIdRaw || "").trim();
  let requestedPeriodMatchesSlot = false;

  // L'UUID transmis par le téléphone est une aide, pas une source de vérité.
  // Après une modification d'EDT, le PWA peut encore avoir l'ancien UUID alors
  // que le jour et les heures du créneau sont toujours valides. Dans ce cas on
  // doit résoudre le créneau courant dans le Cloud au lieu de répondre vide.
  if (requestedPeriodId) {
    const { data: requested, error: requestedError } = await srv
      .from("institution_periods")
      .select("id,weekday,start_time,end_time")
      .eq("institution_id", institutionId)
      .eq("id", requestedPeriodId)
      .maybeSingle();

    if (requestedError) throw requestedError;

    if (!requested) {
      // Sans slot vérifiable on ne peut pas remplacer un UUID devenu inconnu.
      if (!parsed) return [];
    } else {
      if (!parsed) return [requestedPeriodId];

      const requestedWeekday = Number((requested as any).weekday);
      const weekdayMatches =
        requestedWeekday === parsed.weekday ||
        (parsed.weekday === 7 && requestedWeekday === 0);
      const timeMatches =
        hmsToMin((requested as any).start_time) === hmsToMin(`${parsed.startHM}:00`) &&
        hmsToMin((requested as any).end_time) === hmsToMin(`${parsed.endHM}:00`);
      requestedPeriodMatchesSlot = weekdayMatches && timeMatches;
    }
  }

  let weekdayValues: number[] = [];
  let wantedStartMin: number | null = null;
  let wantedEndMin: number | null = null;

  if (parsed) {
    weekdayValues = uniq<number>([parsed.weekday, parsed.weekday === 7 ? 0 : parsed.weekday]);
    wantedStartMin = hmsToMin(`${parsed.startHM}:00`);
    wantedEndMin = hmsToMin(`${parsed.endHM}:00`);
  } else {
    const now = new Date();
    const weekday = weekdayInTZ1to7(now, tz);
    weekdayValues = uniq<number>([weekday, weekday === 7 ? 0 : weekday]);
    const nowMin = hmsToMin(`${hmInTZ(now, tz)}:00`);
    wantedStartMin = nowMin;
    wantedEndMin = null;
  }

  const { data: periods, error: periodsErr } = await srv
    .from("institution_periods")
    .select("id,weekday,start_time,end_time,period_no")
    .eq("institution_id", institutionId)
    .in("weekday", weekdayValues)
    .order("period_no", { ascending: true });

  if (periodsErr) {
    throw periodsErr;
  }

  const rows = (periods || []) as Array<{
    id?: string | null;
    weekday?: number | null;
    start_time?: string | null;
    end_time?: string | null;
  }>;

  if (!rows.length) return [];

  if (parsed && wantedStartMin != null && wantedEndMin != null) {
    const exact = rows.filter((p) => {
      const startMin = hmsToMin(p.start_time);
      const endMin = hmsToMin(p.end_time);
      return startMin === wantedStartMin && endMin === wantedEndMin;
    });

    if (exact.length > 0) {
      return uniq([
        requestedPeriodMatchesSlot ? requestedPeriodId : "",
        ...exact.map((p) => String(p.id || "")),
      ].filter(Boolean));
    }

    const covering = rows.filter((p) => {
      const startMin = hmsToMin(p.start_time);
      const endMin = hmsToMin(p.end_time);
      return wantedStartMin >= startMin && wantedStartMin < endMin;
    });

    return uniq(covering.map((p) => String(p.id || "")).filter(Boolean));
  }

  if (wantedStartMin == null) return [];

  const active = rows.filter((p) => {
    const startMin = hmsToMin(p.start_time);
    const endMin = hmsToMin(p.end_time);
    return wantedStartMin >= startMin && wantedStartMin < endMin;
  });

  return uniq(active.map((p) => String(p.id || "")).filter(Boolean));
}

async function mapSubjectIdsToItems(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string,
  rawSubjectIds: string[],
  aliases?: Map<string, SubjectItem[]>
): Promise<SubjectItem[]> {
  const subjectIds = uniq(rawSubjectIds.map((x) => String(x || "").trim()).filter(Boolean));
  if (!subjectIds.length) return [];

  const instRows: any[] = [];
  const instSeen = new Set<string>();

  {
    const { data, error } = await srv
      .from("institution_subjects")
      .select("id,subject_id,custom_name,subjects:subject_id(name)")
      .eq("institution_id", institutionId)
      .in("id", subjectIds);

    if (error) throw error;

    for (const row of data || []) {
      const id = String((row as any)?.id || "").trim();
      if (id && !instSeen.has(id)) {
        instRows.push(row);
        instSeen.add(id);
      }
    }
  }

  {
    const { data, error } = await srv
      .from("institution_subjects")
      .select("id,subject_id,custom_name,subjects:subject_id(name)")
      .eq("institution_id", institutionId)
      .in("subject_id", subjectIds);

    if (error) throw error;

    for (const row of data || []) {
      const id = String((row as any)?.id || "").trim();
      if (id && !instSeen.has(id)) {
        instRows.push(row);
        instSeen.add(id);
      }
    }
  }

  const covered = new Set<string>();
  for (const row of instRows) {
    const instId = String((row as any)?.id || "").trim();
    const canonicalId = String((row as any)?.subject_id || "").trim();
    if (instId) covered.add(instId);
    if (canonicalId) covered.add(canonicalId);
  }

  const leftovers = subjectIds.filter((id) => !covered.has(id));

  const itemsMap = new Map<string, SubjectItem>();

  for (const row of instRows) {
    const id = String((row as any)?.id || "").trim();
    const label = String((row as any)?.custom_name || (row as any)?.subjects?.name || "—").trim();
    if (id && !itemsMap.has(id)) {
      const item = { id, label: label || "—" };
      itemsMap.set(id, item);
      for (const alias of uniq([id, String(row.subject_id || "")])) {
        aliases?.set(alias, [...(aliases?.get(alias) || []), item]);
      }
    }
  }

  if (leftovers.length > 0) {
    const { data, error } = await srv
      .from("subjects")
      .select("id,name")
      .in("id", leftovers);

    if (error) throw error;

    for (const row of data || []) {
      const id = String((row as any)?.id || "").trim();
      const label = String((row as any)?.name || "—").trim();
      if (id && !itemsMap.has(id)) {
        const item = { id, label: label || "—" };
        itemsMap.set(id, item);
        aliases?.set(id, [item]);
      }
    }
  }

  return Array.from(itemsMap.values()).sort((a, b) => a.label.localeCompare(b.label, "fr"));
}

async function getLegacySubjectIds(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  classId: string,
  institutionId: string
): Promise<string[]> {
  const ids: string[] = [];

  {
    const { data, error } = await srv
      .from("class_teachers")
      .select("subject_id")
      .eq("class_id", classId);

    if (error) throw error;

    ids.push(
      ...((data || []) as any[])
        .map((row) => String(row?.subject_id || "").trim())
        .filter(Boolean)
    );
  }

  // Fallback supplémentaire : certaines classes ont déjà des notes pour des matières
  // qui ne remontent pas (ou plus) dans class_teachers.
  try {
    const { data, error } = await srv
      .from("grade_flat_marks")
      .select("subject_id")
      .eq("class_id", classId)
      .eq("institution_id", institutionId);

    if (!error) {
      ids.push(
        ...((data || []) as any[])
          .map((row) => String(row?.subject_id || "").trim())
          .filter(Boolean)
      );
    }
  } catch {
    // optionnel : on n'échoue pas si ce fallback n'est pas dispo
  }

  return uniq(ids);
}

export async function GET(req: NextRequest) {
  try {
    const supa = await getSupabaseServerClient();
    const srv = getSupabaseServiceClient();

    const {
      data: { user },
    } = await supa.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const preparingOffline = url.searchParams.get("offline_preparation") === "v1";
    const manualCourse = url.searchParams.get("manual_course") === "1";
    const class_id = (url.searchParams.get("class_id") ?? "").trim();
    const slotRaw = (url.searchParams.get("slot") ?? "").trim() || null;
    const periodIdRaw = (url.searchParams.get("period_id") ?? "").trim() || null;

    if (!class_id) {
      return NextResponse.json({ items: [] as SubjectItem[] });
    }

    const { data: cls, error: clsErr } = await srv
      .from("classes")
      .select("id,label,level,institution_id,class_phone_e164,education_type,formation_code,formation_level_code")
      .eq("id", class_id)
      .maybeSingle();

    if (clsErr) {
      return NextResponse.json({ error: clsErr.message }, { status: 400 });
    }
    if (!cls) {
      return NextResponse.json({ items: [] as SubjectItem[] });
    }

    const match = await classDeviceMayAccessClass({
      service: srv,
      userId: user.id,
      userPhone: user.phone,
      classId: class_id,
    });

    if (!match) {
      return NextResponse.json({ error: "forbidden_not_class_device" }, { status: 403 });
    }

    const institutionId = String(cls.institution_id || "").trim();
    if (!institutionId) {
      return NextResponse.json({ items: [] as SubjectItem[] });
    }

    const nonGeneral = isNonGeneralAttendanceEducation(
      (cls as any).education_type,
    );
    if (
      nonGeneral &&
      !attendanceClassContextIsComplete({
        educationType: (cls as any).education_type,
        formationCode: (cls as any).formation_code,
        formationLevelCode: (cls as any).formation_level_code,
      })
    ) {
      return NextResponse.json(
        {
          error: "class_education_context_incomplete",
          message:
            "Cette classe doit être rattachée à une formation et à une année de formation.",
        },
        { status: 409 },
      );
    }

    const { data: inst, error: instErr } = await srv
      .from("institutions")
      .select("id,tz")
      .eq("id", institutionId)
      .maybeSingle();

    if (instErr) {
      return NextResponse.json({ error: instErr.message }, { status: 400 });
    }

    const tz = String(inst?.tz || "Africa/Abidjan");

    const { data: revisionRow, error: revisionError } = await srv
      .from("attendance_schedule_revisions")
      .select(preparingOffline ? "*" : "revision")
      .eq("institution_id", institutionId)
      .maybeSingle();
    if (revisionError) {
      return NextResponse.json({ error: revisionError.message }, { status: 400 });
    }
    const scheduleRevision = Number(revisionRow?.revision ?? 0);
    if (!Number.isSafeInteger(scheduleRevision) || scheduleRevision < 0) {
      return NextResponse.json(
        { error: "schedule_revision_invalid" },
        { status: 409 },
      );
    }
    const scheduleMeta = {
      institution_id: institutionId,
      class_id,
      actor_profile_id: user.id,
      schedule_revision: scheduleRevision,
    };
    async function scheduleJson(items: SubjectItem[]) {
      if (preparingOffline) {
        const initial = {
          schedule_revision: scheduleRevision,
          preparation_revision: revisionRow?.preparation_revision == null ? null : Number(revisionRow.preparation_revision),
        };
        const final = await readAttendancePreparationSnapshot(srv, institutionId);
        if (!attendancePreparationSnapshotsMatch(initial, final)) {
          return NextResponse.json({ error: "schedule_changed_during_read" }, { status: 409 });
        }
        return NextResponse.json({ ...scheduleMeta, ...final, items }, {
          headers: { "Cache-Control": "private, no-store, max-age=0" },
        });
      } else if (scheduleRevision !== await readAttendanceScheduleRevision(srv, institutionId)) {
        return NextResponse.json({ error: "schedule_changed_during_read" }, { status: 409 });
      }
      return NextResponse.json({ ...scheduleMeta, items }, {
        headers: { "Cache-Control": "private, no-store, max-age=0" },
      });
    }

    if (preparingOffline && url.searchParams.get("all_slots") === "1") {
      // A weekly download has a fixed query count, independent of the number
      // of periods. Reuse the same subject identity mapping as interactive calls.
      const [periodsResult, timetableResult] = await Promise.all([
        srv.from("institution_periods")
          .select("id,weekday,label,start_time,end_time", { count: "exact" })
          .eq("institution_id", institutionId).order("weekday").order("start_time"),
        srv.from("teacher_timetables").select("period_id,subject_id", { count: "exact" })
          .eq("institution_id", institutionId).eq("class_id", class_id),
      ]);
      if (periodsResult.error || timetableResult.error) {
        return NextResponse.json({ error: "class_weekly_schedule_unavailable" }, { status: 503 });
      }
      const periods = periodsResult.data || [];
      const timetable = timetableResult.data || [];
      if (periodsResult.count !== periods.length || timetableResult.count !== timetable.length) {
        return NextResponse.json({ error: "class_weekly_schedule_incomplete" }, { status: 503 });
      }
      const periodIds = new Set(periods.map((period) => period.id));
      if (timetable.some((row) => !periodIds.has(row.period_id) || !row.subject_id)) {
        return NextResponse.json({ error: "class_weekly_schedule_incomplete" }, { status: 409 });
      }
      const aliases = new Map<string, SubjectItem[]>();
      const ids = currentTimetableSubjectIds(timetable);
      await mapSubjectIdsToItems(srv, institutionId, ids, aliases);
      if (ids.some((id) => !aliases.has(id))) {
        return NextResponse.json({ error: "class_weekly_subject_missing" }, { status: 409 });
      }
      const byPeriod = new Map<string, SubjectItem[]>();
      for (const row of timetable) {
        const id = String(row.period_id || "");
        byPeriod.set(id, [...(byPeriod.get(id) || []), ...(aliases.get(String(row.subject_id)) || [])]);
      }
      const slotsByKey = new Map<string, { key: string; items: SubjectItem[] }>();
      for (const period of periods) {
        const weekday = Number(period.weekday) === 0 ? 7 : Number(period.weekday);
        const key = `${weekday}|${String(period.start_time).slice(0, 5)}|${String(period.end_time).slice(0, 5)}`;
        const previous = slotsByKey.get(key)?.items || [];
        const items = Array.from(new Map([...previous, ...(byPeriod.get(period.id) || [])]
          .map((item) => [item.id, item])).values());
        slotsByKey.set(key, { key, items });
      }
      const final = await readAttendancePreparationSnapshot(srv, institutionId);
      const initial = { schedule_revision: scheduleRevision,
        preparation_revision: revisionRow?.preparation_revision == null ? null : Number(revisionRow.preparation_revision) };
      if (!attendancePreparationSnapshotsMatch(initial, final)) {
        return NextResponse.json({ error: "schedule_changed_during_read" }, { status: 409 });
      }
      return NextResponse.json({ ...scheduleMeta, ...final, snapshot_completeness: "complete",
        slots: Array.from(slotsByKey.values()) }, {
        headers: { "Cache-Control": "private, no-store, max-age=0" },
      });
    }

    // 1) Si un slot est fourni, le filtrage par emploi du temps est strict.
    //    Une réponse vide signifie qu'aucun cours n'est prévu : ne jamais exposer
    //    toutes les matières de la classe dans ce cas.
    if (!manualCourse && slotRaw && !slotRaw.startsWith("closed|") && !slotRaw.startsWith("no-config|")) {
      const periodIds = await resolveAutoPeriodIds(
        srv,
        institutionId,
        tz,
        slotRaw,
        periodIdRaw,
      );

      if (periodIds.length > 0) {
        const { data: ttRows, error: ttErr } = await srv
          .from("teacher_timetables")
          .select("id,subject_id,updated_at")
          .eq("institution_id", institutionId)
          .eq("class_id", class_id)
          .in("period_id", periodIds);

        if (ttErr) {
          return NextResponse.json({ error: ttErr.message }, { status: 400 });
        }

        // Plusieurs matières peuvent être légitimes au même créneau
        // (groupes de langues notamment). On restitue exactement les matières
        // présentes dans l'EDT Cloud courant.
        const autoSubjectIds = currentTimetableSubjectIds(
          (ttRows || []) as TimetableSubjectRow[],
        );

        if (autoSubjectIds.length > 0) {
          const autoItems = await mapSubjectIdsToItems(srv, institutionId, autoSubjectIds);
          if (autoItems.length > 0) {
            return scheduleJson(autoItems);
          }
        }
      }

      return scheduleJson([]);
    }

    // Voie exceptionnelle explicite : pas de filtre par EDT, mais seulement
    // les disciplines ayant un UNIQUE enseignant effectivement affecté.
    // Une seule lecture des affectations et jamais de scan des notes.
    if (manualCourse) {
      const dateParts = new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(new Date());
      const dayPart = (type: string) => dateParts.find((p) => p.type === type)?.value || "";
      const localDate = `${dayPart("year")}-${dayPart("month")}-${dayPart("day")}`;
      const { data: assigned, error: assignedError } = await srv
        .from("class_teachers")
        .select("subject_id,teacher_id,start_date,end_date")
        .eq("institution_id", institutionId)
        .eq("class_id", class_id);
      if (assignedError) {
        return NextResponse.json({ error: "class_teacher_lookup_unavailable" }, { status: 503 });
      }

      const bySubject = new Map<string, Set<string>>();
      for (const row of assigned || []) {
        const subjectId = String(row.subject_id || "").trim();
        const teacherId = String(row.teacher_id || "").trim();
        const start = String(row.start_date || "").slice(0, 10);
        const end = String(row.end_date || "").slice(0, 10);
        if (!subjectId || !teacherId ||
            (start && start > localDate) || (end && end < localDate)) continue;
        if (!bySubject.has(subjectId)) bySubject.set(subjectId, new Set());
        bySubject.get(subjectId)!.add(teacherId);
      }
      let assignedSubjectIds = Array.from(bySubject.entries())
        .filter(([, teachers]) => teachers.size === 1)
        .map(([subjectId]) => subjectId);

      // Les classes spécialisées ne peuvent pas utiliser une matière absente
      // du programme de leur formation/niveau.
      if (nonGeneral && assignedSubjectIds.length) {
        const { data: configured, error: configuredError } = await srv
          .from("institution_level_subjects")
          .select("subject_id")
          .eq("institution_id", institutionId)
          .eq("education_type", String((cls as any).education_type || ""))
          .eq("formation_code", String((cls as any).formation_code || ""))
          .eq("level_code", String((cls as any).formation_level_code || ""))
          .eq("is_active", true);
        if (configuredError) {
          return NextResponse.json({ error: "formation_subject_lookup_unavailable" }, { status: 503 });
        }
        const allowed = new Set((configured || []).map((row) => String(row.subject_id || "")));
        // Résolution des identifiants institutionnels et canoniques en aval.
        const resolved = await mapSubjectIdsToItems(srv, institutionId, assignedSubjectIds);
        const allowedItems: SubjectItem[] = [];
        const { data: institutionRows, error: instSubjectsError } = await srv
          .from("institution_subjects")
          .select("id,subject_id")
          .eq("institution_id", institutionId)
          .in("id", resolved.map((item) => item.id));
        if (instSubjectsError) return NextResponse.json({ error: "subject_lookup_unavailable" }, { status: 503 });
        const canonicalById = new Map((institutionRows || []).map((row) => [String(row.id), String(row.subject_id || "")]));
        for (const item of resolved) {
          if (allowed.has(canonicalById.get(item.id) || item.id)) allowedItems.push(item);
        }
        return scheduleJson(allowedItems);
      }
      return scheduleJson(await mapSubjectIdsToItems(srv, institutionId, assignedSubjectIds));
    }

    // 2) Sans créneau demandé : constitution du cache de secours.
    // Le général conserve exactement son fallback historique.
    // Les autres enseignements utilisent le référentiel de la formation/niveau.
    if (nonGeneral) {
      const { data: configuredRows, error: configuredError } = await srv
        .from("institution_level_subjects")
        .select("subject_id,order_index")
        .eq("institution_id", institutionId)
        .eq(
          "education_type",
          String((cls as any).education_type || ""),
        )
        .eq("formation_code", String((cls as any).formation_code || ""))
        .eq(
          "level_code",
          String((cls as any).formation_level_code || ""),
        )
        .eq("is_active", true)
        .order("order_index", { ascending: true });

      if (configuredError) {
        return NextResponse.json(
          { error: configuredError.message },
          { status: 400 },
        );
      }

      const configuredSubjectIds = uniq<string>(
        (configuredRows || [])
          .map((row: any) => String(row.subject_id || "").trim())
          .filter(Boolean),
      );
      if (!configuredSubjectIds.length) {
        return NextResponse.json({ items: [] as SubjectItem[] });
      }

      const configuredItems = await mapSubjectIdsToItems(
        srv,
        institutionId,
        configuredSubjectIds,
      );
      return NextResponse.json({ ...scheduleMeta, items: configuredItems });
    }

    const legacySubjectIds = await getLegacySubjectIds(
      srv,
      class_id,
      institutionId,
    );
    if (!legacySubjectIds.length) {
      return NextResponse.json({ ...scheduleMeta, items: [] as SubjectItem[] });
    }

    const legacyItems = await mapSubjectIdsToItems(
      srv,
      institutionId,
      legacySubjectIds,
    );
    return NextResponse.json({ ...scheduleMeta, items: legacyItems });
  } catch (err: any) {
    console.error("[class.subjects] unexpected error", err);
    return NextResponse.json({ error: err?.message || "class_subjects_failed" }, { status: 500 });
  }
}

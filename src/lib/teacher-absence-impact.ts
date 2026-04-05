import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export type ImpactSlot = {
  date: string;
  class_id: string;
  class_label: string;
  subject_id: string | null;
  subject_name: string;
  period_id: string;
  period_label: string;
  start_time: string | null;
  end_time: string | null;
  lost_hours: number;
};

export type ImpactedClassSummary = {
  class_id: string;
  class_label: string;
  lost_hours: number;
  lost_sessions: number;
  slots: ImpactSlot[];
};

export type AbsenceImpactSummary = {
  total_lost_hours: number;
  total_lost_sessions: number;
  impacted_classes: ImpactedClassSummary[];
};

export type MakeupPlan = {
  proposed_start_date: string | null;
  proposed_end_date: string | null;
  notes: string;
};

function parseYMD(ymd: string | null): Date | null {
  if (!ymd) return null;
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function toYMD(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function hmsToMin(hms: string | null | undefined): number {
  const s = String(hms || "00:00:00").slice(0, 8);
  const [h, m] = s.split(":").map((n) => parseInt(n, 10));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

function normalizeTimeFromDb(raw: string | null | undefined): string | null {
  const t = String(raw || "").trim();
  if (!t) return null;
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

function parseWeekday(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const n = parseInt(String(raw ?? ""), 10);
  return Number.isFinite(n) ? n : null;
}

type WeekdayMode = "iso" | "js" | "mon0";

function detectWeekdayMode(periods: any[]): WeekdayMode {
  const vals = Array.from(
    new Set(
      (periods || [])
        .map((p) => parseWeekday(p?.weekday))
        .filter((v): v is number => v !== null)
    )
  );

  if (vals.includes(7)) return "iso";

  const max = vals.length ? Math.max(...vals) : 6;
  if (max === 5) return "mon0";
  if (vals.includes(0) && max === 6) return "js";

  return "iso";
}

function jsDayToDbWeekday(jsDay0to6: number, mode: WeekdayMode): number {
  if (mode === "js") return jsDay0to6;
  if (mode === "iso") return jsDay0to6 === 0 ? 7 : jsDay0to6;
  return (jsDay0to6 + 6) % 7;
}

export function computeRequestedDaysInclusive(start_date: string, end_date: string) {
  const a = parseYMD(start_date);
  const b = parseYMD(end_date);
  if (!a || !b) return 0;

  const start = a.getTime() <= b.getTime() ? a : b;
  const end = a.getTime() <= b.getTime() ? b : a;
  const diffMs = end.getTime() - start.getTime();
  return Math.floor(diffMs / 86400000) + 1;
}

export async function buildTeacherAbsenceImpact(params: {
  institution_id: string;
  teacher_id: string;
  start_date: string;
  end_date: string;
}): Promise<AbsenceImpactSummary> {
  const { institution_id, teacher_id, start_date, end_date } = params;
  const srv = getSupabaseServiceClient();

  const start = parseYMD(start_date);
  const end = parseYMD(end_date);
  if (!start || !end) {
    throw new Error("Période invalide.");
  }

  const from = start.getTime() <= end.getTime() ? start : end;
  const to = start.getTime() <= end.getTime() ? end : start;

  const dates: { ymd: string; weekdayJs: number }[] = [];
  const cursor = new Date(from.getTime());
  while (cursor.getTime() <= to.getTime()) {
    dates.push({
      ymd: toYMD(cursor),
      weekdayJs: cursor.getUTCDay(),
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const [
    { data: periods, error: pErr },
    { data: tts, error: ttErr },
    { data: classes, error: cErr },
    { data: subjects, error: sErr },
  ] = await Promise.all([
    srv
      .from("institution_periods")
      .select("id,weekday,label,start_time,end_time")
      .eq("institution_id", institution_id),
    srv
      .from("teacher_timetables")
      .select("id,class_id,subject_id,teacher_id,weekday,period_id")
      .eq("institution_id", institution_id)
      .eq("teacher_id", teacher_id),
    srv.from("classes").select("id,label").eq("institution_id", institution_id),
    srv
      .from("institution_subjects")
      .select("id,subject_id,custom_name,subjects:subject_id(id,name)")
      .eq("institution_id", institution_id),
  ]);

  if (pErr) throw new Error(pErr.message);
  if (ttErr) throw new Error(ttErr.message);
  if (cErr) throw new Error(cErr.message);
  if (sErr) throw new Error(sErr.message);

  const classLabelById = new Map<string, string>();
  (classes || []).forEach((c: any) => {
    classLabelById.set(String(c.id), String(c.label || ""));
  });

  const subjectNameByInstitutionId = new Map<string, string>();
  const instSubjectIdsByBaseId = new Map<string, string[]>();

  (subjects || []).forEach((row: any) => {
    const instId = String(row.id);
    const baseId = row.subject_id ? String(row.subject_id) : "";
    let baseName = "";

    if (Array.isArray(row.subjects)) {
      baseName = row.subjects[0]?.name || "";
    } else if (row.subjects && typeof row.subjects === "object") {
      baseName = row.subjects.name || "";
    }

    subjectNameByInstitutionId.set(
      instId,
      String(row.custom_name || baseName || "Discipline").trim()
    );

    if (baseId) {
      const arr = instSubjectIdsByBaseId.get(baseId) || [];
      arr.push(instId);
      instSubjectIdsByBaseId.set(baseId, arr);
    }
  });

  const periodById = new Map<
    string,
    {
      id: string;
      weekday: number;
      label: string | null;
      start_time: string | null;
      end_time: string | null;
      startMin: number;
      endMin: number;
    }
  >();

  (periods || []).forEach((p: any) => {
    periodById.set(String(p.id), {
      id: String(p.id),
      weekday: parseWeekday(p.weekday) ?? 0,
      label: (p.label as string | null) ?? null,
      start_time: normalizeTimeFromDb(p.start_time),
      end_time: normalizeTimeFromDb(p.end_time),
      startMin: hmsToMin(p.start_time),
      endMin: hmsToMin(p.end_time),
    });
  });

  const weekdayMode = detectWeekdayMode(periods || []);
  const datesByWeekday = new Map<number, string[]>();

  for (const d of dates) {
    const dbWeekday = jsDayToDbWeekday(d.weekdayJs, weekdayMode);
    const arr = datesByWeekday.get(dbWeekday) || [];
    arr.push(d.ymd);
    datesByWeekday.set(dbWeekday, arr);
  }

  const rawSlots: ImpactSlot[] = [];
  const dedupe = new Set<string>();

  for (const tt of tts || []) {
    const period = periodById.get(String(tt.period_id));
    if (!period) continue;

    const ttWeekday = parseWeekday(tt.weekday);
    const effectiveWeekday = ttWeekday ?? period.weekday;
    const datesForDay = datesByWeekday.get(effectiveWeekday) || [];
    if (!datesForDay.length) continue;

    const class_id = String(tt.class_id || "");
    const class_label = classLabelById.get(class_id) || "Classe";

    const subject_id = tt.subject_id ? String(tt.subject_id) : null;
    let subject_name = "Discipline";

    if (subject_id) {
      subject_name = subjectNameByInstitutionId.get(subject_id) || "";
      if (!subject_name) {
        const mappedInstIds = instSubjectIdsByBaseId.get(subject_id) || [];
        if (mappedInstIds.length > 0) {
          subject_name =
            subjectNameByInstitutionId.get(mappedInstIds[0]) || "Discipline";
        }
      }
    }

    const lost_hours = Number(
      (Math.max(0, period.endMin - period.startMin) / 60).toFixed(2)
    );

    const period_label =
      period.label ||
      [period.start_time || "", period.end_time || ""].filter(Boolean).join(" – ");

    for (const ymd of datesForDay) {
      const key = [ymd, class_id, subject_id || "", tt.period_id].join("|");
      if (dedupe.has(key)) continue;
      dedupe.add(key);

      rawSlots.push({
        date: ymd,
        class_id,
        class_label,
        subject_id,
        subject_name: subject_name || "Discipline",
        period_id: String(tt.period_id),
        period_label,
        start_time: period.start_time,
        end_time: period.end_time,
        lost_hours,
      });
    }
  }

  const classMap = new Map<string, ImpactedClassSummary>();

  for (const slot of rawSlots) {
    const current = classMap.get(slot.class_id) || {
      class_id: slot.class_id,
      class_label: slot.class_label,
      lost_hours: 0,
      lost_sessions: 0,
      slots: [],
    };

    current.lost_hours = Number((current.lost_hours + slot.lost_hours).toFixed(2));
    current.lost_sessions += 1;
    current.slots.push(slot);

    classMap.set(slot.class_id, current);
  }

  const impacted_classes = Array.from(classMap.values())
    .map((c) => ({
      ...c,
      slots: [...c.slots].sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        const aa = a.start_time || "00:00";
        const bb = b.start_time || "00:00";
        return aa.localeCompare(bb);
      }),
    }))
    .sort((a, b) => a.class_label.localeCompare(b.class_label, "fr"));

  const total_lost_hours = Number(
    impacted_classes.reduce((sum, c) => sum + c.lost_hours, 0).toFixed(2)
  );
  const total_lost_sessions = impacted_classes.reduce(
    (sum, c) => sum + c.lost_sessions,
    0
  );

  return {
    total_lost_hours,
    total_lost_sessions,
    impacted_classes,
  };
}
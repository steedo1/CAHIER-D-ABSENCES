// Fallback used only when the full attendance monitor has no fresh verified data.
// This module never reads sessions or asserts a missing/started attendance call.
type Period = { id: string; weekday?: number | string | null; label?: string | null; start_time: string; end_time: string };
type Timetable = { id?: string; class_id: string; subject_id: string | null; teacher_id: string | null; period_id: string };
type ClassRow = { id: string; label: string; level?: string | null; education_type?: string | null; formation_code?: string | null; formation_level_code?: string | null };
type Teacher = { id: string; display_name?: string | null; email?: string | null; phone?: string | null };
type Subject = { id: string; custom_name?: string | null; subjects?: { id?: string; name?: string } | Array<{ id?: string; name?: string }> | null };

export function weekdayCodeForDate(date: string, periods: Array<Pick<Period, "weekday">>) {
  const jsDay = new Date(date + "T12:00:00Z").getUTCDay();
  const codes = new Set(periods.map((p) => Number(p.weekday)).filter(Number.isFinite));
  if (codes.has(7)) return jsDay || 7; // ISO (Monday = 1)
  if (codes.has(6)) return jsDay;       // JS (Sunday = 0)
  if (codes.has(0) && !codes.has(5)) return (jsDay + 6) % 7;
  return jsDay;                        // School weekday values 1..5 are JS, not Monday=0
}

export function schedulePreviewRows(input: {
  date: string;
  periods: Period[];
  timetables: Timetable[];
  classes: ClassRow[];
  teachers: Teacher[];
  subjects: Subject[];
}) {
  const periods = new Map(input.periods.map((p) => [String(p.id), p]));
  const classes = new Map(input.classes.map((c) => [String(c.id), c]));
  const teachers = new Map(input.teachers.map((t) => [String(t.id), t]));
  const subjects = new Map<string, string>();
  for (const subject of input.subjects) {
    const base = Array.isArray(subject.subjects) ? subject.subjects[0] : subject.subjects;
    const name = String(subject.custom_name || base?.name || "Discipline").trim();
    subjects.set(String(subject.id), name);
    if (base?.id && !subjects.has(String(base.id))) subjects.set(String(base.id), name);
  }
  return input.timetables.flatMap((tt) => {
    const period = periods.get(String(tt.period_id));
    const cls = classes.get(String(tt.class_id));
    if (!period || !cls) return [];
    const teacher = teachers.get(String(tt.teacher_id || ""));
    const start = String(period.start_time || "").slice(0, 5);
    const end = String(period.end_time || "").slice(0, 5);
    if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) return [];
    return [{
      id: [input.date, tt.period_id, tt.class_id, tt.subject_id, tt.teacher_id].join("|"),
      date: input.date,
      planned_start: start,
      planned_end: end,
      period_label: period.label || start + " – " + end,
      class_id: cls.id,
      class_label: cls.label,
      class_level: cls.level ?? null,
      education_type: cls.education_type ?? null,
      formation_code: cls.formation_code ?? null,
      formation_level_code: cls.formation_level_code ?? null,
      subject_name: subjects.get(String(tt.subject_id || "")) || "Discipline",
      teacher_name: teacher?.display_name || teacher?.email || "Enseignant",
      teacher_phone: teacher?.phone || null,
      status: "unconfirmed" as const,
    }];
  });
}

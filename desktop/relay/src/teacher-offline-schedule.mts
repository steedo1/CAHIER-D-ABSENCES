import { getInstitutionMeta, type RelayDatabase } from "./db.mjs";
import { parseStoredJson } from "./json.mjs";
import { institutionScheduleContract } from "./schedule-contract.mjs";
import {
  relayActorClassId,
  relayActorKind,
  type AuthenticatedRelayTeacher,
} from "./teacher-auth.mjs";

type TimetableRow = {
  period_id: string;
  weekday: number | null;
  label: string | null;
  start_time: string;
  end_time: string;
  class_id: string;
  class_label: string;
  level: string | null;
  subject_id: string;
  subject_name: string;
  teacher_id: string;
};

type RosterRow = {
  class_id: string;
  id: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string;
  registration_number: string | null;
  gender: string | null;
};

function normalizedWeekday(value: number | null) {
  if (value === 0) return 7;
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 7
    ? Number(value)
    : 1;
}

function hm(value: string) {
  const match = String(value || "").match(/^(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : "00:00";
}

export function teacherOfflineSchedule(
  db: RelayDatabase,
  teacher: AuthenticatedRelayTeacher,
  now = new Date(),
) {
  const contract = institutionScheduleContract(db, teacher.institution_id);
  if (contract.snapshot_revision === null) {
    throw new Error("schedule_snapshot_not_prepared");
  }

  const actorKind = relayActorKind(teacher);
  const boundClassId = relayActorClassId(teacher);
  const actorFilter = actorKind === "class_device"
    ? "AND tt.class_id = ?"
    : "AND tt.teacher_id = ?";
  const actorFilterValue = actorKind === "class_device"
    ? boundClassId
    : teacher.actor_profile_id;
  if (!actorFilterValue) {
    throw new Error("class_device_not_paired_with_relay");
  }

  const rows = db.prepare(`
    SELECT
      tt.period_id,
      p.weekday,
      p.label,
      p.start_time,
      p.end_time,
      tt.class_id,
      c.label AS class_label,
      c.level,
      tt.subject_id,
      s.name AS subject_name,
      tt.teacher_id
    FROM teacher_timetables tt
    JOIN institution_periods p
      ON p.institution_id = tt.institution_id
     AND p.id = tt.period_id
     AND p.deleted_at IS NULL
    JOIN classes c
      ON c.institution_id = tt.institution_id
     AND c.id = tt.class_id
     AND c.deleted_at IS NULL
    JOIN subjects s
      ON s.institution_id = tt.institution_id
     AND s.id = tt.subject_id
     AND s.deleted_at IS NULL
    WHERE tt.institution_id = ?
      ${actorFilter}
      AND tt.deleted_at IS NULL
    ORDER BY p.weekday, p.start_time, c.label, s.name
  `).all(
    teacher.institution_id,
    actorFilterValue,
  ) as TimetableRow[];

  const grouped = new Map<string, {
    key: string;
    period_id: string;
    weekday: number;
    label: string;
    start_time: string;
    end_time: string;
    items: Array<{
      class_id: string;
      class_label: string;
      level: string;
      subject_id: string;
      subject_name: string;
      teacher_id: string;
    }>;
  }>();
  for (const row of rows) {
    const weekday = normalizedWeekday(row.weekday);
    const startTime = hm(row.start_time);
    const endTime = hm(row.end_time);
    const key = `${weekday}|${startTime}|${endTime}`;
    const groupKey = actorKind === "class_device" ? `${key}|${row.period_id}` : key;
    const slot = grouped.get(groupKey) || {
      key,
      period_id: row.period_id,
      weekday,
      label: String(row.label || "Séance"),
      start_time: startTime,
      end_time: endTime,
      items: [],
    };
    if (
      !slot.items.some(
        (item) =>
          item.class_id === row.class_id &&
          item.subject_id === row.subject_id &&
          item.teacher_id === row.teacher_id,
      )
    ) {
      slot.items.push({
        class_id: row.class_id,
        class_label: row.class_label,
        level: String(row.level || ""),
        subject_id: row.subject_id,
        subject_name: row.subject_name,
        teacher_id: row.teacher_id,
      });
    }
    grouped.set(groupKey, slot);
  }

  const classIds = actorKind === "class_device" && boundClassId
    ? [boundClassId]
    : Array.from(new Set(rows.map((row) => row.class_id)));
  const rosterRows = classIds.length === 0
    ? []
    : db.prepare(`
        SELECT
          ce.class_id,
          s.id,
          s.first_name,
          s.last_name,
          s.display_name,
          s.registration_number,
          s.gender
        FROM class_enrollments ce
        JOIN students s
          ON s.institution_id = ce.institution_id
         AND s.id = ce.student_id
         AND s.deleted_at IS NULL
         AND s.is_active = 1
        WHERE ce.institution_id = ?
          AND ce.class_id IN (${classIds.map(() => "?").join(",")})
          AND ce.deleted_at IS NULL
          AND (ce.end_date IS NULL OR ce.end_date >= date('now'))
        ORDER BY ce.class_id, s.display_name, s.id
      `).all(teacher.institution_id, ...classIds) as RosterRow[];
  const rosters = Object.fromEntries(
    classIds.map((classId) => [
      classId,
      {
        items: rosterRows
          .filter((row) => row.class_id === classId)
          .map((row) => ({
            id: row.id,
            first_name: row.first_name,
            last_name: row.last_name,
            full_name: row.display_name,
            matricule: row.registration_number,
            gender: row.gender,
          })),
      },
    ]),
  );
  const manifest = parseStoredJson<{
    class_teachers?: Array<{
      institution_id?: string;
      class_id?: string;
      teacher_id?: string;
      subject_id?: string | null;
      start_date?: string | null;
      end_date?: string | null;
    }>;
  }>(
    getInstitutionMeta(
      db,
      teacher.institution_id,
      "attendance_schedule_manifest",
    ),
  ) || {};
  const manifestAssignments = Array.isArray(manifest.class_teachers)
    ? manifest.class_teachers
    : [];
  const today = now.toISOString().slice(0, 10);
  const assignments = manifestAssignments.filter(
    (row) =>
      String(row.institution_id || "") === teacher.institution_id &&
      (
        actorKind === "class_device"
          ? String(row.class_id || "") === boundClassId
          : String(row.teacher_id || "") === teacher.actor_profile_id
      ) &&
      (!row.start_date || String(row.start_date) <= today) &&
      (!row.end_date || String(row.end_date) >= today),
  );

  return {
    version: 1,
    institution_id: teacher.institution_id,
    actor_kind: actorKind,
    class_id: boundClassId,
    schedule_revision: contract.snapshot_revision,
    generated_at: contract.generated_at,
    relay_time: now.toISOString(),
    snapshot_completeness: "complete" as const,
    source: "relay" as const,
    slots: Array.from(grouped.values()),
    class_count: classIds.length,
    slot_count: grouped.size,
    rosters,
    assignments,
  };
}

type CloudScheduleInput = {
  institutionId: string;
  classId: string;
  actorProfileId: string;
  classLabel: string;
  classLevel: string;
};

type CloudScheduleRows = {
  revision: number;
  generatedAt: string;
  periods: any[];
  timetables: any[];
  subjects: any[];
  enrollments: any[];
  students: any[];
  assignments: any[];
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function weekday(value: unknown) {
  const parsed = Number(value);
  if (parsed === 0) return 7;
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 7 ? parsed : 1;
}

function hm(value: unknown, fallback = "00:00") {
  const match = text(value).match(/^(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : fallback;
}

function activeOn(row: any, today: string) {
  const start = text(row?.start_date);
  const end = text(row?.end_date);
  return (!start || start <= today) && (!end || end >= today);
}

export function projectClassDeviceCloudSchedule(
  input: CloudScheduleInput,
  rows: CloudScheduleRows,
) {
  const periodById = new Map(
    rows.periods
      .map((row) => [text(row?.id), row] as const)
      .filter(([id]) => Boolean(id)),
  );
  const subjectById = new Map<string, { id: string; name: string }>();
  for (const row of rows.subjects) {
    const id = text(row?.id);
    if (!id) continue;
    const linked = Array.isArray(row?.subjects)
      ? row.subjects[0] || {}
      : row?.subjects || {};
    const subject = {
      id,
      name: text(row?.custom_name || linked?.name) || "Matière",
    };
    subjectById.set(id, subject);
    const baseId = text(row?.subject_id);
    if (baseId && !subjectById.has(baseId)) subjectById.set(baseId, subject);
  }

  // Le relais conserve une seule affectation par classe/créneau. Le Cloud
  // applique le même principe en choisissant l'identifiant le plus récent
  // lexicalement lorsque des lignes historiques coexistent encore.
  const timetableBySlot = new Map<string, any>();
  for (const row of rows.timetables) {
    if (
      text(row?.institution_id) !== input.institutionId ||
      text(row?.class_id) !== input.classId
    ) {
      continue;
    }
    const period = periodById.get(text(row?.period_id));
    if (!period) continue;
    const key = `${input.classId}|${text(row?.period_id)}|${weekday(period?.weekday)}`;
    const current = timetableBySlot.get(key);
    if (!current || text(row?.id).localeCompare(text(current?.id)) > 0) {
      timetableBySlot.set(key, row);
    }
  }

  const slots = Array.from(timetableBySlot.values())
    .map((row) => {
      const period = periodById.get(text(row?.period_id));
      if (!period) return null;
      const subject = subjectById.get(text(row?.subject_id));
      if (!subject) return null;
      const day = weekday(period?.weekday);
      const startTime = hm(period?.start_time);
      const endTime = hm(period?.end_time);
      return {
        key: `${day}|${startTime}|${endTime}`,
        period_id: text(row?.period_id),
        weekday: day,
        label: text(period?.label) || "Séance",
        start_time: startTime,
        end_time: endTime,
        items: [
          {
            class_id: input.classId,
            class_label: input.classLabel || "Classe",
            level: input.classLevel,
            subject_id: subject.id,
            subject_name: subject.name,
            teacher_id: text(row?.teacher_id),
          },
        ],
      };
    })
    .filter((slot): slot is NonNullable<typeof slot> => Boolean(slot))
    .sort(
      (left, right) =>
        left.weekday - right.weekday ||
        left.start_time.localeCompare(right.start_time),
    );

  if (slots.length === 0) throw new Error("class_offline_schedule_empty");

  const today = new Date().toISOString().slice(0, 10);
  const activeEnrollments = rows.enrollments.filter(
    (row) =>
      text(row?.institution_id) === input.institutionId &&
      text(row?.class_id) === input.classId &&
      activeOn(row, today),
  );
  const enrolledIds = new Set(
    activeEnrollments.map((row) => text(row?.student_id)).filter(Boolean),
  );
  const roster = rows.students
    .filter(
      (row) =>
        text(row?.institution_id) === input.institutionId &&
        enrolledIds.has(text(row?.id)),
    )
    .map((row) => ({
      id: text(row?.id),
      first_name: text(row?.first_name) || null,
      last_name: text(row?.last_name) || null,
      full_name:
        text(row?.full_name) ||
        [text(row?.last_name), text(row?.first_name)].filter(Boolean).join(" "),
      matricule: text(row?.matricule) || null,
      gender: text(row?.gender) || null,
    }))
    .sort((left, right) =>
      left.full_name.localeCompare(right.full_name, "fr", { numeric: true }),
    );
  const assignments = rows.assignments
    .filter(
      (row) =>
        text(row?.institution_id) === input.institutionId &&
        text(row?.class_id) === input.classId &&
        activeOn(row, today),
    )
    .map((row) => ({
      institution_id: input.institutionId,
      class_id: input.classId,
      teacher_id: text(row?.teacher_id),
      subject_id: text(row?.subject_id) || null,
      start_date: text(row?.start_date) || null,
      end_date: text(row?.end_date) || null,
    }));

  return {
    version: 1 as const,
    scope_version: 1,
    institution_id: input.institutionId,
    actor_kind: "class_device" as const,
    class_id: input.classId,
    actor_profile_id: input.actorProfileId,
    schedule_revision: rows.revision,
    generated_at: rows.generatedAt,
    snapshot_completeness: "complete" as const,
    source: "cloud" as const,
    slots,
    class_count: 1,
    slot_count: slots.length,
    rosters: { [input.classId]: { items: roster } },
    assignments,
  };
}

async function selectRows(query: PromiseLike<{ data: any[] | null; error: any }>, label: string) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}:${error.message || error.code || "query_failed"}`);
  return Array.isArray(data) ? data : [];
}

async function readRevision(srv: any, institutionId: string) {
  const { data, error } = await srv
    .from("attendance_schedule_revisions")
    .select("revision,updated_at")
    .eq("institution_id", institutionId)
    .maybeSingle();
  if (error) throw new Error(`attendance_schedule_revision:${error.message}`);
  const revision = Number(data?.revision ?? 0);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error("attendance_schedule_revision_invalid");
  }
  return {
    revision,
    generatedAt: text(data?.updated_at) || new Date().toISOString(),
  };
}

export async function buildClassDeviceCloudSchedule(
  srv: any,
  input: CloudScheduleInput,
) {
  const before = await readRevision(srv, input.institutionId);
  const [periods, timetables, subjects, enrollments, assignments] =
    await Promise.all([
      selectRows(
        srv
          .from("institution_periods")
          .select("id,institution_id,weekday,label,start_time,end_time")
          .eq("institution_id", input.institutionId),
        "institution_periods",
      ),
      selectRows(
        srv
          .from("teacher_timetables")
          .select("id,institution_id,class_id,subject_id,teacher_id,period_id,weekday")
          .eq("institution_id", input.institutionId)
          .eq("class_id", input.classId),
        "teacher_timetables",
      ),
      selectRows(
        srv
          .from("institution_subjects")
          .select("id,institution_id,subject_id,custom_name,subjects:subject_id(name,code)")
          .eq("institution_id", input.institutionId),
        "institution_subjects",
      ),
      selectRows(
        srv
          .from("class_enrollments")
          .select("institution_id,class_id,student_id,start_date,end_date")
          .eq("institution_id", input.institutionId)
          .eq("class_id", input.classId),
        "class_enrollments",
      ),
      selectRows(
        srv
          .from("class_teachers")
          .select("institution_id,class_id,teacher_id,subject_id,start_date,end_date")
          .eq("institution_id", input.institutionId)
          .eq("class_id", input.classId),
        "class_teachers",
      ),
    ]);
  const studentIds = Array.from(
    new Set(enrollments.map((row) => text(row?.student_id)).filter(Boolean)),
  );
  const students = studentIds.length
    ? await selectRows(
        srv
          .from("students")
          .select("id,institution_id,matricule,first_name,last_name,full_name,gender")
          .eq("institution_id", input.institutionId)
          .in("id", studentIds),
        "students",
      )
    : [];
  const after = await readRevision(srv, input.institutionId);
  if (before.revision !== after.revision) {
    throw new Error("schedule_changed_during_prepare");
  }
  return projectClassDeviceCloudSchedule(input, {
    revision: after.revision,
    generatedAt: after.generatedAt,
    periods,
    timetables,
    subjects,
    enrollments,
    students,
    assignments,
  });
}

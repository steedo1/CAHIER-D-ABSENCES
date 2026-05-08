type AnyRecord = Record<string, any>;

function asArray<T = AnyRecord>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function clean(value: unknown, fallback = ""): string {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function slotKey(period: AnyRecord) {
  return `${Number(period.weekday ?? 0)}:${Number(period.period_no ?? 0)}`;
}

function scorePercent(placed: number, total: number) {
  if (total <= 0) return 0;
  return Math.round((placed / total) * 100);
}

export function generateDraftTimetableFromSnapshot(sourceSnapshot: unknown) {
  const snapshot = (sourceSnapshot || {}) as AnyRecord;

  const periods = asArray(snapshot.periods)
    .filter((period) => period && typeof period === "object")
    .sort((a, b) => {
      const aw = Number(a.weekday ?? 0);
      const bw = Number(b.weekday ?? 0);
      if (aw !== bw) return aw - bw;

      const ap = Number(a.period_no ?? 0);
      const bp = Number(b.period_no ?? 0);
      if (ap !== bp) return ap - bp;

      return clean(a.start_time).localeCompare(clean(b.start_time));
    });

  const affectations = asArray(snapshot.affectations).filter(
    (item) =>
      item &&
      typeof item === "object" &&
      clean(item.teacher_id) &&
      clean(item.class_id)
  );

  const assignments: AnyRecord[] = [];
  const unplaced: AnyRecord[] = [];
  const diagnostics: AnyRecord[] = [];

  if (periods.length === 0) {
    diagnostics.push({
      level: "error",
      message: "Aucun créneau disponible pour générer un montage.",
    });
  }

  if (affectations.length === 0) {
    diagnostics.push({
      level: "warning",
      message: "Aucune affectation enseignant-matière-classe disponible.",
    });
  }

  const classBusy = new Set<string>();
  const teacherBusy = new Set<string>();

  let cursor = 0;

  for (let index = 0; index < affectations.length; index += 1) {
    const affectation = affectations[index];
    let selectedPeriod: AnyRecord | null = null;

    for (let attempt = 0; attempt < periods.length; attempt += 1) {
      const period = periods[(cursor + attempt) % periods.length];
      const key = slotKey(period);

      const teacherKey = `${clean(affectation.teacher_id)}:${key}`;
      const classKey = `${clean(affectation.class_id)}:${key}`;

      if (teacherBusy.has(teacherKey)) continue;
      if (classBusy.has(classKey)) continue;

      selectedPeriod = period;
      teacherBusy.add(teacherKey);
      classBusy.add(classKey);
      cursor = cursor + attempt + 1;
      break;
    }

    if (!selectedPeriod) {
      unplaced.push({
        teacher_id: clean(affectation.teacher_id),
        teacher_name: clean(affectation.teacher_name, "Enseignant"),
        subject_id: affectation.subject_id ? clean(affectation.subject_id) : null,
        subject_label: clean(affectation.subject_label, "Matière"),
        class_id: clean(affectation.class_id),
        class_label: clean(affectation.class_label, "Classe"),
        reason: "Aucun créneau libre trouvé sans conflit classe/professeur.",
      });
      continue;
    }

    assignments.push({
      id: `draft-${index + 1}`,
      class_id: clean(affectation.class_id),
      class_label: clean(affectation.class_label, "Classe"),
      teacher_id: clean(affectation.teacher_id),
      teacher_name: clean(affectation.teacher_name, "Enseignant"),
      subject_id: affectation.subject_id ? clean(affectation.subject_id) : null,
      subject_label: clean(affectation.subject_label, "Matière"),

      period_id: clean(selectedPeriod.id),
      weekday: Number(selectedPeriod.weekday ?? 0),
      period_no: Number(selectedPeriod.period_no ?? 0),
      period_label: clean(selectedPeriod.label, `Séance ${selectedPeriod.period_no ?? ""}`),
      start_time: selectedPeriod.start_time ?? null,
      end_time: selectedPeriod.end_time ?? null,
      duration_min: Number(selectedPeriod.duration_min ?? 60),

      room: null,
      source: "montage_preview_v1",
    });
  }

  if (unplaced.length > 0) {
    diagnostics.push({
      level: "warning",
      message: `${unplaced.length} affectation(s) n’ont pas pu être placées dans ce pré-montage.`,
    });
  }

  const result = {
    status: "generated_preview",
    generated_at: new Date().toISOString(),
    summary: {
      classes_count: asArray(snapshot.classes).length,
      subjects_count: asArray(snapshot.subjects).length,
      teachers_count: asArray(snapshot.teachers).length,
      periods_count: periods.length,
      affectations_count: affectations.length,
      assignments_count: assignments.length,
      unplaced_count: unplaced.length,
      score: scorePercent(assignments.length, affectations.length),
    },
    assignments,
    unplaced,
    diagnostics,
  };

  return result;
}

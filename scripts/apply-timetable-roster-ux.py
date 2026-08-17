from pathlib import Path


def load(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def save(path: str, text: str) -> None:
    Path(path).write_text(text, encoding="utf-8")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly 1 match, got {count}")
    return text.replace(old, new, 1)


# 1) Sidebar wording.
path = "src/app/admin/ui/sidebar-nav.tsx"
text = load(path)
text = replace_once(
    text,
    'label: "Import emplois du temps",',
    'label: "Emploi du temps",',
    "sidebar timetable label",
)
save(path, text)


# 2) Timetable meta API: exact class occupancy.
path = "src/app/api/admin/timetables/meta/route.ts"
text = load(path)
old = '''    return NextResponse.json({
      allClasses,
      classes: scopedClasses,
      subjects: outSubjects,
      teachers: outTeachers,
      periods: outPeriods,
      scope,
    });'''
new = '''    let occupancy: Array<{
      weekday: number;
      period_id: string;
      class_id: string;
      class_label: string;
      teacher_id: string;
      teacher_name: string;
      subject_id: string;
      subject_label: string;
    }> = [];

    if (scope.classId && scopedClassIds.length > 0) {
      const { data: timetableRows, error: timetableErr } = await srv
        .from("teacher_timetables")
        .select("weekday,period_id,class_id,teacher_id,subject_id")
        .eq("institution_id", institution_id)
        .in("class_id", scopedClassIds);

      if (timetableErr) {
        return NextResponse.json(
          { error: "timetable_occupancy_failed", message: timetableErr.message },
          { status: 400 },
        );
      }

      const classLabels = new Map(
        allClasses.map((row) => [row.id, String(row.label || "")]),
      );
      const teacherLabels = new Map(
        outTeachers.map((row) => [row.id, row.display_name]),
      );
      const subjectLabels = new Map(
        outSubjects.map((row) => [row.id, row.label]),
      );

      occupancy = (timetableRows || []).map((row: any) => ({
        weekday: Number(row.weekday),
        period_id: String(row.period_id),
        class_id: String(row.class_id),
        class_label: classLabels.get(String(row.class_id)) || "",
        teacher_id: String(row.teacher_id),
        teacher_name:
          teacherLabels.get(String(row.teacher_id)) || "Autre professeur",
        subject_id: String(row.subject_id),
        subject_label:
          subjectLabels.get(String(row.subject_id)) || "Autre matière",
      }));
    }

    return NextResponse.json({
      allClasses,
      classes: scopedClasses,
      subjects: outSubjects,
      teachers: outTeachers,
      periods: outPeriods,
      occupancy,
      scope,
    });'''
text = replace_once(text, old, new, "meta occupancy response")
save(path, text)


# 3) Manual timetable API: occupancy data and safe clearing.
path = "src/app/api/admin/timetables/manual/route.ts"
text = load(path)
old = '''      return NextResponse.json({
        subject_id,
        teachers: [],
        teacherClasses: [],
        existing: [],
        scope,
      });'''
new = '''      return NextResponse.json({
        subject_id,
        teachers: [],
        teacherClasses: [],
        existing: [],
        occupancy: [],
        teacherOccupancy: [],
        scope,
      });'''
text = replace_once(text, old, new, "manual empty scope response")

old = '''    let existing: {
      weekday: number;
      period_id: string;
      class_id: string;
      class_label: string;
    }[] = [];

    if (teacher_id) {
      const { data: ttRows, error: ttErr } = await srv
        .from("teacher_timetables")
        .select("weekday,period_id,class_id")
        .eq("institution_id", institution_id)
        .eq("subject_id", subject_id)
        .eq("teacher_id", teacher_id)
        .in("class_id", classIds);

      if (ttErr) {
        return NextResponse.json(
          { error: "existing_failed", message: ttErr.message },
          { status: 400 },
        );
      }

      existing = (ttRows || []).map((row: any) => ({
        weekday: Number(row.weekday),
        period_id: String(row.period_id),
        class_id: String(row.class_id),
        class_label: classesById.get(String(row.class_id)) || "",
      }));
    }

    return NextResponse.json({
      subject_id,
      teachers,
      teacherClasses,
      existing,
      scope,
    });'''
new = '''    const { data: scopedTimetableRows, error: occupancyErr } = await srv
      .from("teacher_timetables")
      .select("weekday,period_id,class_id,teacher_id,subject_id")
      .eq("institution_id", institution_id)
      .in("class_id", classIds);

    if (occupancyErr) {
      return NextResponse.json(
        { error: "occupancy_failed", message: occupancyErr.message },
        { status: 400 },
      );
    }

    const occupancy = (scopedTimetableRows || []).map((row: any) => ({
      weekday: Number(row.weekday),
      period_id: String(row.period_id),
      class_id: String(row.class_id),
      class_label: classesById.get(String(row.class_id)) || "",
      teacher_id: String(row.teacher_id),
      subject_id: String(row.subject_id),
    }));

    const existing = teacher_id
      ? occupancy.filter(
          (row) =>
            row.teacher_id === teacher_id && row.subject_id === subject_id,
        )
      : [];

    let teacherOccupancy: Array<{
      weekday: number;
      period_id: string;
      class_id: string;
      class_label: string;
      teacher_id: string;
      subject_id: string;
    }> = [];

    if (teacher_id) {
      const { data: teacherTimetableRows, error: teacherTimetableErr } =
        await srv
          .from("teacher_timetables")
          .select("weekday,period_id,class_id,teacher_id,subject_id")
          .eq("institution_id", institution_id)
          .eq("teacher_id", teacher_id);

      if (teacherTimetableErr) {
        return NextResponse.json(
          {
            error: "teacher_occupancy_failed",
            message: teacherTimetableErr.message,
          },
          { status: 400 },
        );
      }

      const teacherClassesById = new Map(classesById);
      const missingClassIds = uniq(
        (teacherTimetableRows || [])
          .map((row: any) => String(row.class_id || ""))
          .filter((classId) => classId && !teacherClassesById.has(classId)),
      );

      if (missingClassIds.length > 0) {
        const { data: otherClasses, error: otherClassesErr } = await srv
          .from("classes")
          .select("id,label")
          .eq("institution_id", institution_id)
          .in("id", missingClassIds);

        if (otherClassesErr) {
          return NextResponse.json(
            {
              error: "teacher_occupancy_classes_failed",
              message: otherClassesErr.message,
            },
            { status: 400 },
          );
        }

        for (const row of otherClasses || []) {
          teacherClassesById.set(String(row.id), String(row.label || ""));
        }
      }

      teacherOccupancy = (teacherTimetableRows || []).map((row: any) => ({
        weekday: Number(row.weekday),
        period_id: String(row.period_id),
        class_id: String(row.class_id),
        class_label:
          teacherClassesById.get(String(row.class_id)) || "Autre classe",
        teacher_id: String(row.teacher_id),
        subject_id: String(row.subject_id),
      }));
    }

    return NextResponse.json({
      subject_id,
      teachers,
      teacherClasses,
      existing,
      occupancy,
      teacherOccupancy,
      scope,
    });'''
text = replace_once(text, old, new, "manual occupancy response")

old = '''        .delete()
        .match({ institution_id, subject_id, class_id, period_id });'''
new = '''        .delete()
        .match({
          institution_id,
          subject_id,
          teacher_id,
          class_id,
          period_id,
        });'''
text = replace_once(text, old, new, "safe clear slot")
save(path, text)


# 4) Timetable screen UX.
path = "src/app/admin/import-emplois-du-temps/page.tsx"
text = load(path)
old = '''type TimetablesMeta = {
  allClasses: MetaClass[];
  classes: MetaClass[];
  subjects: MetaSubject[];
  teachers: MetaTeacher[];
  periods: MetaPeriod[];
  scope?: EducationScopeValue;
};'''
new = '''type TimetableOccupancy = {
  weekday: number;
  period_id: string;
  class_id: string;
  class_label: string;
  teacher_id: string;
  teacher_name?: string;
  subject_id: string;
  subject_label?: string;
};

type TimetablesMeta = {
  allClasses: MetaClass[];
  classes: MetaClass[];
  subjects: MetaSubject[];
  teachers: MetaTeacher[];
  periods: MetaPeriod[];
  occupancy?: TimetableOccupancy[];
  scope?: EducationScopeValue;
};'''
text = replace_once(text, old, new, "timetable occupancy type")

old = '''  existing: {
    weekday: number;
    period_id: string;
    class_id: string;
    class_label: string;
  }[];
};'''
new = '''  existing: {
    weekday: number;
    period_id: string;
    class_id: string;
    class_label: string;
  }[];
  occupancy: TimetableOccupancy[];
  teacherOccupancy: TimetableOccupancy[];
};'''
text = replace_once(text, old, new, "manual meta occupancy fields")

old = '''      setManualMeta({
        subject_id: json.subject_id,
        teachers: json.teachers || [],
        teacherClasses: json.teacherClasses || [],
        existing: json.existing || [],
      });'''
new = '''      setManualMeta({
        subject_id: json.subject_id,
        teachers: json.teachers || [],
        teacherClasses: json.teacherClasses || [],
        existing: json.existing || [],
        occupancy: json.occupancy || [],
        teacherOccupancy: json.teacherOccupancy || [],
      });'''
text = replace_once(text, old, new, "manual meta assignment")

old = '''  const selectedTeacherLabel = useMemo(() => {
    const list =
      (manualMeta?.teachers?.length ? manualMeta.teachers : null) ||
      meta?.teachers ||
      [];
    return list.find((t) => t.id === selectedTeacherId)?.display_name ?? "";
  }, [manualMeta, meta, selectedTeacherId]);

  function keyForCell(weekday: number, period_id: string) {'''
new = '''  const selectedTeacherLabel = useMemo(() => {
    const list =
      (manualMeta?.teachers?.length ? manualMeta.teachers : null) ||
      meta?.teachers ||
      [];
    return list.find((t) => t.id === selectedTeacherId)?.display_name ?? "";
  }, [manualMeta, meta, selectedTeacherId]);

  const classScopedOccupancy = useMemo(() => {
    const selectedClassId = educationScope.classId;
    if (!selectedClassId) return [] as TimetableOccupancy[];
    const source = manualMeta ? manualMeta.occupancy : meta?.occupancy || [];
    return source.filter((row) => row.class_id === selectedClassId);
  }, [educationScope.classId, manualMeta, meta]);

  const visibleOccupancy = useMemo(() => {
    if (!selectedTeacherId) return classScopedOccupancy;
    return classScopedOccupancy.filter(
      (row) => row.teacher_id === selectedTeacherId,
    );
  }, [classScopedOccupancy, selectedTeacherId]);

  function occupancyTeacherLabel(row: TimetableOccupancy) {
    if (row.teacher_name) return row.teacher_name;
    return (
      meta?.teachers?.find((teacher) => teacher.id === row.teacher_id)
        ?.display_name || "Autre professeur"
    );
  }

  function occupancySubjectLabel(row: TimetableOccupancy) {
    if (row.subject_label) return row.subject_label;
    return (
      meta?.subjects?.find((subject) => subject.id === row.subject_id)?.label ||
      "Autre matière"
    );
  }

  function visibleOccupancyForCell(weekday: number, periodId: string) {
    return visibleOccupancy.filter(
      (row) => row.weekday === weekday && row.period_id === periodId,
    );
  }

  function conflictMessagesForClass(
    classId: string,
    weekday: number,
    periodId: string,
  ) {
    if (!selectedTeacherId) return [] as string[];

    const source = manualMeta ? manualMeta.occupancy : meta?.occupancy || [];
    const messages: string[] = [];

    for (const row of source) {
      if (
        row.class_id === classId &&
        row.weekday === weekday &&
        row.period_id === periodId &&
        row.teacher_id !== selectedTeacherId
      ) {
        messages.push(
          `Classe déjà occupée par ${occupancyTeacherLabel(row)} (${occupancySubjectLabel(row)}).`,
        );
      }
    }

    for (const row of manualMeta?.teacherOccupancy || []) {
      if (
        row.teacher_id === selectedTeacherId &&
        row.weekday === weekday &&
        row.period_id === periodId &&
        row.class_id !== classId
      ) {
        messages.push(
          `${selectedTeacherLabel || "Ce professeur"} est déjà prévu en ${row.class_label || "une autre classe"}.`,
        );
      }
    }

    return Array.from(new Set(messages));
  }

  function keyForCell(weekday: number, period_id: string) {'''
text = replace_once(text, old, new, "occupancy helpers")

old = '''  const activeSelectedIds = useMemo(() => {
    if (!activeKey) return [];
    return cellSelection[activeKey] || [];
  }, [activeKey, cellSelection]);

  const activePeriodLabel = useMemo(() => {'''
new = '''  const activeSelectedIds = useMemo(() => {
    if (!activeKey) return [];
    return cellSelection[activeKey] || [];
  }, [activeKey, cellSelection]);

  const activeConflictMessages = activeCell
    ? Array.from(
        new Set(
          activeSelectedIds.flatMap((classId) =>
            conflictMessagesForClass(
              classId,
              activeCell.weekday,
              activeCell.period_id,
            ),
          ),
        ),
      )
    : [];

  const activePeriodLabel = useMemo(() => {'''
text = replace_once(text, old, new, "active conflict messages")

old = '''                            const period = findPeriod(wd, periodNo);
                            const active = isCellActive(wd, period);
                            const selected = isCellSelected(wd, period);
                            const disabled = !period;

                            const cellLabel = period
                              ? `${period.start_time?.slice(0, 5) || "??:??"}–${
                                  period.end_time?.slice(0, 5) || "??:??"
                                }`
                              : "Aucun créneau";

                            return (
                              <td key={`${wd}_${periodNo}`}>
                                <button
                                  type="button"
                                  disabled={disabled || !selectedSubjectId || !selectedTeacherId}
                                  onClick={() => handleCellClick(wd, period)}
                                  title={cellLabel}
                                  className={[
                                    "w-full rounded-xl border px-2 py-3 text-[10px] md:text-[11px] leading-tight transition",
                                    disabled
                                      ? "border-slate-100 bg-slate-100 text-slate-300 cursor-not-allowed"
                                      : selected
                                      ? "border-emerald-600 bg-emerald-50 text-emerald-900 shadow-sm ring-2 ring-emerald-400/40"
                                      : active
                                      ? "border-emerald-400 bg-emerald-50/70 text-emerald-900"
                                      : "border-slate-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/60",
                                  ].join(" ")}
                                >
                                  {period ? (
                                    <>
                                      <div className="font-medium">
                                        {WEEKDAY_LABELS[wd] ?? `Jour ${wd}`}
                                      </div>
                                      <div className="text-[10px] text-slate-500">
                                        {cellLabel}
                                      </div>
                                      <div className="mt-1 text-[10px]">
                                        {(() => {
                                          const key = keyForCell(wd, period.id);
                                          const selectedIds = cellSelection[key] || [];
                                          if (!selectedIds.length) return "Aucun cours";

                                          const labels = classesForSelectedTeacher
                                            .filter((c) => selectedIds.includes(c.id))
                                            .map((c) => c.label);

                                          if (labels.length > 0) {
                                            const joined = labels.join(", ");
                                            return joined.length > 24
                                              ? `${labels.length} classe(s)`
                                              : joined;
                                          }
                                          return `${selectedIds.length} classe(s)`;
                                        })()}
                                      </div>
                                    </>
                                  ) : (
                                    <span className="text-slate-400">—</span>
                                  )}
                                </button>
                              </td>
                            );'''
new = '''                            const period = findPeriod(wd, periodNo);
                            const active = isCellActive(wd, period);
                            const selected = isCellSelected(wd, period);
                            const disabled = !period;
                            const occupiedRows = period
                              ? visibleOccupancyForCell(wd, period.id)
                              : [];
                            const selectedIds = period
                              ? cellSelection[keyForCell(wd, period.id)] || []
                              : [];
                            const conflictMessages = period
                              ? Array.from(
                                  new Set(
                                    selectedIds.flatMap((classId) =>
                                      conflictMessagesForClass(classId, wd, period.id),
                                    ),
                                  ),
                                )
                              : [];
                            const hasConflict = conflictMessages.length > 0;

                            const cellLabel = period
                              ? `${period.start_time?.slice(0, 5) || "??:??"}–${
                                  period.end_time?.slice(0, 5) || "??:??"
                                }`
                              : "Aucun créneau";

                            return (
                              <td key={`${wd}_${periodNo}`}>
                                <button
                                  type="button"
                                  disabled={disabled || !selectedSubjectId || !selectedTeacherId}
                                  onClick={() => handleCellClick(wd, period)}
                                  title={
                                    hasConflict
                                      ? `${cellLabel} — ${conflictMessages.join(" ")}`
                                      : cellLabel
                                  }
                                  className={[
                                    "w-full rounded-xl border px-2 py-3 text-[10px] md:text-[11px] leading-tight transition",
                                    disabled
                                      ? "border-slate-100 bg-slate-100 text-slate-300 cursor-not-allowed"
                                      : hasConflict
                                      ? "border-amber-400 bg-amber-50 text-amber-950 shadow-sm ring-2 ring-amber-300/40"
                                      : selected
                                      ? "border-emerald-600 bg-emerald-50 text-emerald-900 shadow-sm ring-2 ring-emerald-400/40"
                                      : active
                                      ? "border-emerald-400 bg-emerald-50/70 text-emerald-900"
                                      : occupiedRows.length > 0
                                      ? "border-sky-300 bg-sky-50 text-sky-950"
                                      : "border-slate-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/60",
                                  ].join(" ")}
                                >
                                  {period ? (
                                    <>
                                      <div className="font-medium">
                                        {WEEKDAY_LABELS[wd] ?? `Jour ${wd}`}
                                      </div>
                                      <div className="text-[10px] text-slate-500">
                                        {cellLabel}
                                      </div>
                                      <div className="mt-1 text-[10px]">
                                        {(() => {
                                          if (selectedIds.length > 0) {
                                            const labels = classesForSelectedTeacher
                                              .filter((c) => selectedIds.includes(c.id))
                                              .map((c) => c.label);
                                            if (labels.length > 0) {
                                              const joined = labels.join(", ");
                                              return joined.length > 24
                                                ? `${labels.length} classe(s)`
                                                : joined;
                                            }
                                            return `${selectedIds.length} classe(s)`;
                                          }

                                          if (occupiedRows.length > 0) {
                                            if (selectedTeacherId) {
                                              const labels = occupiedRows.map((row) =>
                                                occupancySubjectLabel(row),
                                              );
                                              return labels.length > 1
                                                ? `${labels.length} cours de ce prof`
                                                : labels[0];
                                            }
                                            const labels = occupiedRows.map(
                                              (row) =>
                                                `${occupancyTeacherLabel(row)} · ${occupancySubjectLabel(row)}`,
                                            );
                                            const joined = labels.join(", ");
                                            return joined.length > 28
                                              ? `${labels.length} cours occupé(s)`
                                              : joined;
                                          }

                                          return "Aucun cours";
                                        })()}
                                      </div>
                                      {hasConflict ? (
                                        <div className="mt-1 inline-flex items-center gap-1 font-semibold text-amber-800">
                                          <AlertTriangle className="h-3 w-3" />
                                          Conflit signalé
                                        </div>
                                      ) : null}
                                    </>
                                  ) : (
                                    <span className="text-slate-400">—</span>
                                  )}
                                </button>
                              </td>
                            );'''
text = replace_once(text, old, new, "grid occupancy rendering")

old = '''                  {!selectedSubjectId || !selectedTeacherId ? (
                    <p className="mt-2 text-[11px] text-slate-500">
                      Sélectionnez une matière et un professeur pour activer le
                      tableau.
                    </p>
                  ) : (
                    <p className="mt-2 text-[11px] text-slate-500">
                      Cliquez une case : la liste des classes est à droite (cochage instantané).
                    </p>
                  )}'''
new = '''                  {!selectedSubjectId || !selectedTeacherId ? (
                    <p className="mt-2 text-[11px] text-slate-500">
                      {educationScope.classId
                        ? "Les créneaux déjà occupés de cette classe sont visibles en bleu. Sélectionnez ensuite une matière et un professeur pour modifier l’emploi du temps."
                        : "Sélectionnez une matière et un professeur pour activer le tableau."}
                    </p>
                  ) : educationScope.classId ? (
                    <p className="mt-2 text-[11px] text-slate-500">
                      La grille affiche maintenant uniquement les créneaux déjà occupés par ce professeur dans la classe choisie. Les chevauchements sont signalés en orange, sans bloquer la saisie.
                    </p>
                  ) : (
                    <p className="mt-2 text-[11px] text-slate-500">
                      Cliquez une case : la liste des classes est à droite (cochage instantané).
                    </p>
                  )}

                  {activeConflictMessages.length > 0 ? (
                    <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-950">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <div>
                        <div className="font-semibold">
                          Conflit signalé — enregistrement autorisé.
                        </div>
                        <ul className="mt-1 list-disc space-y-0.5 pl-4">
                          {activeConflictMessages.map((message) => (
                            <li key={message}>{message}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  ) : null}'''
text = replace_once(text, old, new, "grid helper and warning")

old = '''                      {filteredClasses.map((c) => {
                        const checked = activeSelectedIds.includes(c.id);
                        return (
                          <label
                            key={c.id}
                            className={[
                              "flex items-center gap-2 rounded-xl border px-2 py-2 cursor-pointer text-xs",
                              checked
                                ? "border-emerald-400 bg-emerald-50"
                                : "border-slate-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/60",
                            ].join(" ")}
                          >
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                              checked={checked}
                              onChange={() => toggleClassForActiveCell(c.id)}
                            />
                            <span className="truncate">{c.label}</span>
                          </label>
                        );
                      })}'''
new = '''                      {filteredClasses.map((c) => {
                        const checked = activeSelectedIds.includes(c.id);
                        const conflictMessages = activeCell
                          ? conflictMessagesForClass(
                              c.id,
                              activeCell.weekday,
                              activeCell.period_id,
                            )
                          : [];
                        const hasConflict = checked && conflictMessages.length > 0;
                        return (
                          <label
                            key={c.id}
                            title={conflictMessages.join(" ") || undefined}
                            className={[
                              "flex items-center gap-2 rounded-xl border px-2 py-2 cursor-pointer text-xs",
                              hasConflict
                                ? "border-amber-400 bg-amber-50"
                                : checked
                                ? "border-emerald-400 bg-emerald-50"
                                : "border-slate-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/60",
                            ].join(" ")}
                          >
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                              checked={checked}
                              onChange={() => toggleClassForActiveCell(c.id)}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-1.5">
                                <span className="truncate">{c.label}</span>
                                {conflictMessages.length > 0 ? (
                                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                                ) : null}
                              </span>
                              {hasConflict ? (
                                <span className="mt-0.5 block text-[10px] font-semibold text-amber-800">
                                  Conflit signalé — enregistrement autorisé
                                </span>
                              ) : null}
                            </span>
                          </label>
                        );
                      })}'''
count = text.count(old)
if count != 2:
    raise SystemExit(f"class conflict cards: expected 2 matches, got {count}")
text = text.replace(old, new)
save(path, text)


# 5) Printed roster: four blank note columns.
path = "src/app/admin/classes/liste/[id]/page.tsx"
text = load(path)
old = '''          <div className="text-sm text-slate-600">
            Vérifiez l’éducateur, corrigez au besoin Nom / Prénoms / Matricule /
            Série / Affecté / Interne-Externe / Sexe / Red / LV2 / Nat, puis
            exportez en PDF.
          </div>'''
new = '''          <div className="text-sm text-slate-600">
            Vérifiez l’éducateur et les informations d’identité utiles, puis
            exportez en PDF. Les colonnes Note1 à Note4 restent volontairement
            vides pour la saisie manuelle des notes.
          </div>'''
text = replace_once(text, old, new, "roster toolbar text")

replacements = {
    '<th className="col-series">Série</th>': '<th className="col-series">Note1</th>',
    '<th className="col-board">Ext.</th>': '<th className="col-board">Note2</th>',
    '<th className="col-lv2">LV2</th>': '<th className="col-lv2">Note3</th>',
    '<th className="col-nat">Nat</th>': '<th className="col-nat">Note4</th>',
    '''                      <td className="col-series">
                        {studentSeriesLabel(student.official_track_code)}
                      </td>''': '''                      <td className="col-series"></td>''',
    '''                      <td className="col-board">
                        {boardingShort(student.is_boarder)}
                      </td>''': '''                      <td className="col-board"></td>''',
    '''                      <td className="col-lv2">{normalizeLv2(student.lv2)}</td>''': '''                      <td className="col-lv2"></td>''',
    '''                      <td className="col-nat">
                        {nationalityShort(student.nationality)}
                      </td>''': '''                      <td className="col-nat"></td>''',
}
for old_value, new_value in replacements.items():
    text = replace_once(
        text,
        old_value,
        new_value,
        f"roster replacement {old_value[:35]}",
    )
save(path, text)


# 6) Focused static regression test.
test_path = Path("test/timetable-roster-ux.test.mjs")
test_path.write_text(
    r'''import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");

test("sidebar exposes Emploi du temps without legacy import wording", () => {
  const source = read("src/app/admin/ui/sidebar-nav.tsx");
  assert.match(source, /label: "Emploi du temps"/);
  assert.doesNotMatch(source, /label: "Import emplois du temps"/);
});

test("class timetable occupancy is returned and teacher conflicts remain warnings", () => {
  const meta = read("src/app/api/admin/timetables/meta/route.ts");
  const manual = read("src/app/api/admin/timetables/manual/route.ts");
  const page = read("src/app/admin/import-emplois-du-temps/page.tsx");

  assert.match(meta, /occupancy,/);
  assert.match(meta, /teacher_timetables/);
  assert.match(manual, /teacherOccupancy/);
  assert.match(manual, /teacher_occupancy_failed/);
  assert.match(
    manual,
    /\.match\(\{\s*institution_id,\s*subject_id,\s*teacher_id,\s*class_id,\s*period_id,/s,
  );
  assert.match(page, /visibleOccupancyForCell/);
  assert.match(page, /conflictMessagesForClass/);
  assert.match(page, /Conflit signalé — enregistrement autorisé/);
  assert.match(page, /créneaux déjà occupés de cette classe/);
});

test("printed roster uses four blank note columns instead of unused columns", () => {
  const roster = read("src/app/admin/classes/liste/[id]/page.tsx");
  for (const label of ["Note1", "Note2", "Note3", "Note4"]) {
    assert.match(roster, new RegExp(`>${label}<`));
  }
  for (const label of ["Série", "Ext\\.", "LV2", "Nat"]) {
    assert.doesNotMatch(roster, new RegExp(`>${label}<`));
  }
  assert.match(roster, /<td className="col-series"><\/td>/);
  assert.match(roster, /<td className="col-board"><\/td>/);
  assert.match(roster, /<td className="col-lv2"><\/td>/);
  assert.match(roster, /<td className="col-nat"><\/td>/);
});
''',
    encoding="utf-8",
)

# One-shot helpers must not stay in the feature.
Path(".github/workflows/apply-timetable-roster-ux.yml").unlink(missing_ok=True)
Path("scripts/apply-timetable-roster-ux.py").unlink(missing_ok=True)

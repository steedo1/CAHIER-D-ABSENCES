from pathlib import Path

def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly 1 match, found {count}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")

path = "src/app/class/page.tsx"
replace_once(
    path,
    '''  const [classes, setClasses] = useState<MyClass[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [classId, setClassId] = useState<string>("");
''',
    '''  const [classes, setClasses] = useState<MyClass[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [manualSubjectMode, setManualSubjectMode] = useState(false);
  const [classId, setClassId] = useState<string>("");
''',
)
replace_once(
    path,
    '''  const canUseFallbackLegacyFlow = isOnline && !!activeConfiguredSlot;
  const usingUnverifiedLegacySubjects =
    subjectLoadMode === "legacy-offline" ||
    subjectLoadMode === "legacy-fallback";
  const canStartAttendanceNow =
    !!activeConfiguredSlot && !usingUnverifiedLegacySubjects;
''',
    '''  useEffect(() => {
    setManualSubjectMode(false);
  }, [classId, activeSlotKey]);

  const canUseFallbackLegacyFlow = isOnline && !!activeConfiguredSlot;
  const usingUnverifiedLegacySubjects =
    subjectLoadMode === "legacy-offline" ||
    subjectLoadMode === "legacy-fallback";
  const canStartAttendanceNow =
    !!activeConfiguredSlot &&
    (!usingUnverifiedLegacySubjects || manualSubjectMode);
''',
)
replace_once(
    path,
    '''      const relayList = relaySubjectsForSlot(
        relayClassSchedule,
        classId,
        activeConfiguredSlot,
      );
''',
    '''      if (manualSubjectMode) {
        const legacyList = await loadLegacySubjects();
        applyList(
          legacyList,
          legacyList.length
            ? isOnline
              ? "legacy-fallback"
              : "legacy-offline"
            : "empty",
        );
        setSubjectId("");
        return;
      }

      const relayList = relaySubjectsForSlot(
        relayClassSchedule,
        classId,
        activeConfiguredSlot,
      );
''',
)
replace_once(
    path,
    '''    canUseFallbackLegacyFlow,
    isOnline,
    open,
    relayClassSchedule?.schedule_revision,
''',
    '''    canUseFallbackLegacyFlow,
    isOnline,
    manualSubjectMode,
    open,
    relayClassSchedule?.schedule_revision,
''',
)
replace_once(
    path,
    '''    if (usingUnverifiedLegacySubjects) {
      setMsg(
        "Cet ancien cache reste consultable, mais ne peut pas ouvrir un appel. Actualisez la préparation v5.",
      );
      return;
    }
''',
    '''    if (usingUnverifiedLegacySubjects && !manualSubjectMode) {
      setMsg(
        "Cet ancien cache reste consultable, mais ne peut pas ouvrir un appel. Actualisez la préparation v5.",
      );
      return;
    }
''',
)
replace_once(
    path,
    '''      if (
        preparedSchedule &&
        (!verifiedPeriod ||
          !verifiedSubjects ||
          !verifiedSubjects.some((subject) => subject.id === subjectId))
      ) {
''',
    '''      if (
        preparedSchedule &&
        (!verifiedPeriod ||
          (!manualSubjectMode &&
            (!verifiedSubjects ||
              !verifiedSubjects.some((subject) => subject.id === subjectId))))
      ) {
''',
)
replace_once(
    path,
    '''      const subj = (verifiedSubjects ?? []).find(
        (subject) => subject.id === subjectId,
      );
''',
    '''      const subj = (manualSubjectMode ? subjects : (verifiedSubjects ?? [])).find(
        (subject) => subject.id === subjectId,
      );
''',
)
replace_once(
    path,
    '''        relayBaseUrl: classRelayBaseUrl(selectedClass),
        relayAccessToken: relayPolicy?.relay_access_token,
''',
    '''        relayBaseUrl: manualSubjectMode ? null : classRelayBaseUrl(selectedClass),
        relayAccessToken: manualSubjectMode ? null : relayPolicy?.relay_access_token,
''',
)
replace_once(
    path,
    '''            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
''',
    '''            </Select>
            {activeConfiguredSlot && !open ? (
              <div className="mt-1 flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setManualSubjectMode((current) => !current);
                    setSubjects([]);
                    setSubjectId("");
                    setSubjectLoadMode("empty");
                    setSubjectScheduleIssue(null);
                  }}
                  className="text-[11px] font-semibold text-indigo-700 hover:underline"
                >
                  {manualSubjectMode ? "Retour auto" : "Autre cours"}
                </button>
              </div>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-3">
''',
)
replace_once(path, "{usingLegacyOfflineMode && (", "{usingLegacyOfflineMode && !manualSubjectMode && (")
replace_once(path, "{usingLegacyFallbackMode && (", "{usingLegacyFallbackMode && !manualSubjectMode && (")
replace_once(path, "{noScheduledSubjectNow && (", "{noScheduledSubjectNow && !manualSubjectMode && (")

path = "src/lib/offline-readiness.ts"
replace_once(
    path,
    '''  if (cloudRevision !== null) {
    try {
      await fetchAndCache(
        "/api/teacher/sessions/open",
        "classDevice:open-session",
      );
''',
    '''  const allSubjectsCacheKey = `classDevice:subjects:${classId}`;
  const scheduledSubjects = Array.from(
    new Map(
      schedule.slots.flatMap((slot) =>
        (slot.items || [])
          .filter((item) => String(item.class_id || "") === classId)
          .map((item) => [
            String(item.subject_id || ""),
            {
              id: String(item.subject_id || ""),
              label: String(item.subject_name || "Matière").trim() || "Matière",
            },
          ] as const),
      ),
    ).values(),
  ).filter((subject) => Boolean(subject.id));
  await cacheSet(allSubjectsCacheKey, { items: scheduledSubjects });
  if (cloudRevision !== null) {
    onProgress("Préparation des disciplines de la classe…");
    try {
      await fetchAndCache(
        `/api/class/subjects?class_id=${encodeURIComponent(classId)}`,
        allSubjectsCacheKey,
      );
    } catch {
      // Le planning préparé reste valide ; le cache hebdomadaire reste utilisable.
    }

    try {
      await fetchAndCache(
        "/api/teacher/sessions/open",
        "classDevice:open-session",
      );
''',
)

path = "src/app/api/class/sessions/start/route.ts"
replace_once(
    path,
    '''    if (scheduledTeacherIds.length === 0) {
      return NextResponse.json(
        {
          error: "class_subject_not_scheduled_for_slot",
          message:
            "Démarrage refusé : cette discipline n’est pas prévue pour cette classe dans le créneau en cours selon l’emploi du temps.",
        },
        { status: 403 }
      );
    }

    if (scheduledTeacherIds.length > 1) {
''',
    '''    if (scheduledTeacherIds.length > 1) {
''',
)
replace_once(
    path,
    '''    const teacher_id = scheduledTeacherIds[0]!;

    let expected_minutes: number | null;
''',
    '''    const sessionDate = ymdInTZ(actualCallAt, tz);
    let teacher_id = scheduledTeacherIds[0] || "";
    let isHorsEdt = false;

    if (!teacher_id) {
      const assignmentSubjectIds = uniq<string>(
        [instSubjectId, canonicalSubjectId]
          .map((value) => String(value || "").trim())
          .filter(Boolean),
      );
      const { data: assignmentRows, error: assignmentErr } = await srv
        .from("class_teachers")
        .select("teacher_id,start_date,end_date")
        .eq("institution_id", cls.institution_id)
        .eq("class_id", class_id)
        .in("subject_id", assignmentSubjectIds);

      if (assignmentErr) {
        return NextResponse.json(
          { error: "class_teacher_lookup_unavailable" },
          { status: 503 },
        );
      }

      const assignedTeacherIds = uniq<string>(
        ((assignmentRows || []) as any[])
          .filter((row) => {
            const start = String(row.start_date || "").slice(0, 10);
            const end = String(row.end_date || "").slice(0, 10);
            return (!start || start <= sessionDate) && (!end || end >= sessionDate);
          })
          .map((row) => String(row.teacher_id || ""))
          .filter(Boolean),
      );

      if (assignedTeacherIds.length === 0) {
        return NextResponse.json(
          {
            error: "class_subject_not_assigned_to_teacher",
            message:
              "Cette discipline n’est affectée à aucun enseignant de cette classe.",
          },
          { status: 403 },
        );
      }
      if (assignedTeacherIds.length > 1) {
        return NextResponse.json(
          {
            error: "ambiguous_class_subject_teacher",
            message:
              "Plusieurs enseignants sont affectés à cette discipline dans cette classe. Impossible d’attribuer la séance automatiquement.",
          },
          { status: 409 },
        );
      }
      teacher_id = assignedTeacherIds[0]!;
      isHorsEdt = true;
    }

    let expected_minutes: number | null;
''',
)
replace_once(
    path,
    '''    const ymd = ymdInTZ(actualCallAt, tz);
    const hh = Math.floor(currentPeriod.startMin / 60);
''',
    '''    const ymd = sessionDate;
    const hh = Math.floor(currentPeriod.startMin / 60);
''',
)
replace_once(
    path,
    '''        idempotent,
        clock_anomaly:
''',
    '''        idempotent,
        hors_edt: isHorsEdt,
        clock_anomaly:
''',
)

path = "src/app/api/admin/attendance/monitor/route.ts"
replace_once(
    path,
    '''  const matchedSessionIds = new Set(rows.map((row) => row.session_id).filter(Boolean));
  const unmatchedSessionCount = (sessions || []).filter((session: any) =>
    scopedClassIds.has(String(session.class_id)) && !matchedSessionIds.has(String(session.id)),
  ).length;
''',
    '''  const matchedSessionIds = new Set(rows.map((row) => row.session_id).filter(Boolean));
  const unmatchedSessions = (sessions || [])
    .filter((session: any) =>
      scopedClassIds.has(String(session.class_id)) &&
      !matchedSessionIds.has(String(session.id)),
    )
    .map((session: any) => {
      const classId = String(session.class_id || "");
      const subjectId = String(session.subject_id || "");
      const teacherId = String(session.teacher_id || "");
      const classRow = classById.get(classId);
      return {
        id: String(session.id),
        date: isoToYMD(String(session.started_at)),
        actual_call_at: session.actual_call_at ? String(session.actual_call_at) : null,
        ended_at: session.ended_at ? String(session.ended_at) : null,
        class_id: classId || null,
        class_label: String(classRow?.label || "").trim() || null,
        subject_id: subjectId || null,
        subject_name: subjectNameById.get(subjectId) || "Discipline",
        teacher_id: teacherId || null,
        teacher_name: teacherNameById.get(teacherId) || "Enseignant",
      };
    })
    .sort((a: any, b: any) =>
      `${a.date}|${a.actual_call_at || ""}|${a.class_label || ""}`.localeCompare(
        `${b.date}|${b.actual_call_at || ""}|${b.class_label || ""}`,
      ),
    );
  const unmatchedSessionCount = unmatchedSessions.length;
''',
)
replace_once(
    path,
    '''      rows,
      unmatched_session_count: unmatchedSessionCount,
      education_scope: educationScope,
''',
    '''      rows,
      unmatched_session_count: unmatchedSessionCount,
      unmatched_sessions: unmatchedSessions,
      education_scope: educationScope,
''',
)
replace_once(
    path,
    '''  return NextResponse.json({ institution_id, education_scope: educationScope, rows, unmatched_session_count: unmatchedSessionCount });
''',
    '''  return NextResponse.json({
    institution_id,
    education_scope: educationScope,
    rows,
    unmatched_session_count: unmatchedSessionCount,
    unmatched_sessions: unmatchedSessions,
  });
''',
)

path = "src/app/admin/absences/appels/page.tsx"
replace_once(
    path,
    '''type DetailedRow = MonitorRow & {
''',
    '''type HorsEdtRow = {
  id: string;
  date: string;
  actual_call_at?: string | null;
  ended_at?: string | null;
  class_label?: string | null;
  subject_name?: string | null;
  teacher_name: string;
};

type DetailedRow = MonitorRow & {
''',
)
replace_once(
    path,
    '''  const [unmatchedSessions, setUnmatchedSessions] = useState(0);
  const [reportContext, setReportContext] = useState<ReportContext>({
''',
    '''  const [unmatchedSessions, setUnmatchedSessions] = useState(0);
  const [horsEdtRows, setHorsEdtRows] = useState<HorsEdtRow[]>([]);
  const [reportContext, setReportContext] = useState<ReportContext>({
''',
)
replace_once(
    path,
    '''      setFreshness(null);
      setUnmatchedSessions(0);
    }
''',
    '''      setFreshness(null);
      setUnmatchedSessions(0);
      setHorsEdtRows([]);
    }
''',
)
replace_once(
    path,
    '''      setRows(monitorRows);
      setUnmatchedSessions(Number((monitorResult.data as { unmatched_session_count?: number }).unmatched_session_count || 0));
      setFreshness({ source: monitorResult.source, savedAt: monitorResult.saved_at });
''',
    '''      setRows(monitorRows);
      const monitorMeta = monitorResult.data as {
        unmatched_session_count?: number;
        unmatched_sessions?: HorsEdtRow[];
      };
      setUnmatchedSessions(Number(monitorMeta.unmatched_session_count || 0));
      setHorsEdtRows(
        Array.isArray(monitorMeta.unmatched_sessions)
          ? monitorMeta.unmatched_sessions
          : [],
      );
      setFreshness({ source: monitorResult.source, savedAt: monitorResult.saved_at });
''',
)
replace_once(
    path,
    '''          {unmatchedSessions > 0 ? <p role="alert" className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{unmatchedSessions} séance(s) reçue(s) ne correspondent pas à l’EDT actuel. Les absences et durées du bilan doivent être vérifiées ; ces séances ne sont pas réaffectées automatiquement à un autre cours.</p> : null}
''',
    '''          {unmatchedSessions > 0 ? (
            <details className="mb-3 rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-sm text-indigo-950">
              <summary className="cursor-pointer font-semibold">
                Cours hors EDT : {unmatchedSessions}
              </summary>
              <p className="mt-1 text-xs text-indigo-800">
                Cours réellement enregistrés sans correspondance dans l’EDT actuel.
              </p>
              {horsEdtRows.length > 0 ? (
                <div className="mt-2 space-y-1 text-xs">
                  {horsEdtRows.map((row) => (
                    <div key={row.id} className="rounded-md bg-white/70 px-2 py-1">
                      {formatDateFr(row.date)} · {isoToHm(row.actual_call_at) || "heure non reçue"} · {row.class_label || "Classe"} · {row.subject_name || "Discipline"} · {row.teacher_name}
                    </div>
                  ))}
                </div>
              ) : null}
            </details>
          ) : null}
''',
)

path = "src/app/admin/finance/payroll/page.tsx"
replace_once(
    path,
    '''  adjusted_amount?: number | string | null;
};
''',
    '''  adjusted_amount?: number | string | null;
  hors_edt_sessions?: number;
};
''',
)
replace_once(
    path,
    '''    const sessionItems = expectedSlots.map((slot) => {
      const matched = findPayrollSession(actualRows, usedRows, slot);
      const expectedMinutes = Math.max(1, numberValue(slot.expected_minutes) || sessionReferenceMinutes);
      const rate = slot.cycle === "first_cycle" ? rateFirst : rateSecond;
      return {
        ...slot,
        ...calculatePayrollSession(matched, expectedMinutes, sessionReferenceMinutes, rate, lateToleranceMin, earlyDepartureToleranceMin),
      };
    });

    const expectedSessions = sessionItems.length;
    const actualSessions = sessionItems.filter((item) => item.counted_for_pay).length;
    const expectedMinutes = sessionItems.reduce((acc, item) => acc + item.expected_minutes, 0);
''',
    '''    const plannedSessionItems = expectedSlots.map((slot) => {
      const matched = findPayrollSession(actualRows, usedRows, slot);
      const expectedMinutes = Math.max(1, numberValue(slot.expected_minutes) || sessionReferenceMinutes);
      const rate = slot.cycle === "first_cycle" ? rateFirst : rateSecond;
      return {
        ...slot,
        ...calculatePayrollSession(matched, expectedMinutes, sessionReferenceMinutes, rate, lateToleranceMin, earlyDepartureToleranceMin),
      };
    });

    const horsEdtItems = actualRows.flatMap((row, index) => {
      if (usedRows.has(index) || !row.actual_call_iso || !row.ended_at) return [];
      const classIds = row.class_ids?.length
        ? row.class_ids
        : row.class_id
          ? [row.class_id]
          : [];
      const subjectIds = row.subject_ids?.length
        ? row.subject_ids
        : row.subject_id
          ? [row.subject_id]
          : [];
      const classId = classIds[0] || null;
      const subjectId = subjectIds[0] || null;
      if (!classId || !subjectId) return [];
      const sessionDate = String(row.dateISO || "").slice(0, 10);
      if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(sessionDate)) return [];

      const cycle = cycleFromLevel(classMap.get(classId)?.level);
      const expectedMinutes = Math.max(
        1,
        numberValue(row.expected_minutes) || sessionReferenceMinutes,
      );
      const rate = cycle === "first_cycle" ? rateFirst : rateSecond;
      const calculated = calculatePayrollSession(
        row,
        expectedMinutes,
        sessionReferenceMinutes,
        rate,
        lateToleranceMin,
        earlyDepartureToleranceMin,
      );
      if (!calculated.counted_for_pay) return [];

      return [{
        class_id: classId,
        subject_id: subjectId,
        period_id: null,
        session_date: sessionDate,
        start_time: null,
        weekday: new Date(`${sessionDate}T00:00:00Z`).getUTCDay(),
        cycle,
        expected_minutes: expectedMinutes,
        ...calculated,
        source_origin: "class_device_hors_edt",
      }];
    });

    const sessionItems = [...plannedSessionItems, ...horsEdtItems];
    const expectedSessions = expectedSlots.length;
    const actualSessions = sessionItems.filter((item) => item.counted_for_pay).length;
    const expectedMinutes = plannedSessionItems.reduce((acc, item) => acc + item.expected_minutes, 0);
''',
)
replace_once(
    path,
    '''  const lines = (linesResult.data ?? []) as TeacherPayrollLineRow[];
  const vacataires = teachers.filter((t) => t.payroll_enabled && t.employment_type === "vacataire");
  const totals = lines.reduce(
''',
    '''  const baseLines = (linesResult.data ?? []) as TeacherPayrollLineRow[];
  const horsEdtResult = selectedRun
    ? await supabase
        .schema("finance")
        .from("teacher_payroll_line_sessions")
        .select("line_id")
        .eq("run_id", selectedRun.id)
        .eq("source_origin", "class_device_hors_edt")
        .eq("counted_for_pay", true)
    : { data: [], error: null as any };
  if (horsEdtResult.error) throw new Error(horsEdtResult.error.message);

  const horsEdtByLine = new Map<string, number>();
  for (const row of horsEdtResult.data ?? []) {
    const lineId = String((row as any).line_id || "");
    if (!lineId) continue;
    horsEdtByLine.set(lineId, (horsEdtByLine.get(lineId) || 0) + 1);
  }

  const lines = baseLines.map((row) => ({
    ...row,
    hors_edt_sessions: horsEdtByLine.get(row.id) || 0,
  }));
  const vacataires = teachers.filter((t) => t.payroll_enabled && t.employment_type === "vacataire");
  const totals = lines.reduce(
''',
)
replace_once(
    path,
    '''      acc.payable += payrollPayable(row);
      return acc;
    },
    { expectedSessions: 0, actualSessions: 0, actualMinutes: 0, lostMinutes: 0, gross: 0, retained: 0, payable: 0 },
''',
    '''      acc.payable += payrollPayable(row);
      acc.horsEdtSessions += numberValue(row.hors_edt_sessions);
      return acc;
    },
    { expectedSessions: 0, actualSessions: 0, actualMinutes: 0, lostMinutes: 0, gross: 0, retained: 0, payable: 0, horsEdtSessions: 0 },
''',
)
replace_once(
    path,
    '''              <p className="mt-2 text-sm text-slate-600">{lines.length} vacataire(s) · {totals.actualSessions} séance(s) payée(s) · Total {formatMoney(totals.payable)}</p>
''',
    '''              <p className="mt-2 text-sm text-slate-600">{lines.length} vacataire(s) · {totals.actualSessions} séance(s) payée(s){totals.horsEdtSessions > 0 ? ` · dont ${totals.horsEdtSessions} hors EDT` : ""} · Total {formatMoney(totals.payable)}</p>
''',
)
replace_once(
    path,
    '''                        <div className="mt-1 text-xs text-slate-500">1er cycle : {row.sessions_first_cycle} · 2nd cycle : {row.sessions_second_cycle}</div>
''',
    '''                        <div className="mt-1 text-xs text-slate-500">1er cycle : {row.sessions_first_cycle} · 2nd cycle : {row.sessions_second_cycle}</div>
                        {numberValue(row.hors_edt_sessions) > 0 ? (
                          <div className="mt-1 text-xs font-semibold text-indigo-700">Hors EDT : {row.hors_edt_sessions}</div>
                        ) : null}
''',
)

path = "src/app/admin/finance/payroll/PayrollPrintSheet.tsx"
replace_once(
    path,
    '''  lines: Array<{ id: string; teacher_name_snapshot: string | null; actual_sessions: number; expected_sessions: number;
    gross_amount: number | string; lost_amount?: number | string | null; adjusted_amount?: number | string | null }>;
  totals: { actualSessions: number; gross: number; retained: number; payable: number };
''',
    '''  lines: Array<{ id: string; teacher_name_snapshot: string | null; actual_sessions: number; expected_sessions: number;
    gross_amount: number | string; lost_amount?: number | string | null; adjusted_amount?: number | string | null; hors_edt_sessions?: number }>;
  totals: { actualSessions: number; gross: number; retained: number; payable: number; horsEdtSessions: number };
''',
)
replace_once(
    path,
    '''          <div className="mt-2 text-sm">Séance de référence : {effectiveReferenceMinutes} min · Retard toléré : {effectiveLateTolerance} min · Sortie anticipée tolérée : {effectiveEarlyTolerance} min</div>
''',
    '''          <div className="mt-2 text-sm">Séance de référence : {effectiveReferenceMinutes} min · Retard toléré : {effectiveLateTolerance} min · Sortie anticipée tolérée : {effectiveEarlyTolerance} min{totals.horsEdtSessions > 0 ? ` · Cours hors EDT payés : ${totals.horsEdtSessions}` : ""}</div>
''',
)
replace_once(
    path,
    '''                <td className="border border-slate-300 p-2 text-right">{row.actual_sessions} / {row.expected_sessions}</td>
''',
    '''                <td className="border border-slate-300 p-2 text-right">
                  {row.actual_sessions} / {row.expected_sessions}
                  {Number(row.hors_edt_sessions || 0) > 0 ? (
                    <div className="mt-1 text-[10px] font-semibold">dont {row.hors_edt_sessions} hors EDT</div>
                  ) : null}
                </td>
''',
)

print("Hors-EDT patch applied successfully")

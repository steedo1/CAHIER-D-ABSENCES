from pathlib import Path

p = Path('src/app/admin/finance/payroll/page.tsx')
text = p.read_text(encoding='utf-8')

old = '''    const [stats, expectedSlots] = await Promise.all([\n      fetchStatisticsDetailServer(teacher.profile_id, effectiveRange.periodStart, effectiveRange.periodEnd),\n      buildExpectedSlotsForTeacher({\n        admin,\n        institutionId,\n        teacherId: teacher.profile_id,\n        periodStart: effectiveRange.periodStart,\n        periodEnd: effectiveRange.periodEnd,\n        classMap,\n        referenceMinutes: sessionReferenceMinutes,\n      }),\n    ]);\n\n    const actualRows = (stats.rows || []).filter((r) => !!r.actual_call_iso || numberValue(r.real_minutes) > 0);\n'''
new = '''    const [stats, expectedSlots, assignmentsResult] = await Promise.all([\n      fetchStatisticsDetailServer(teacher.profile_id, effectiveRange.periodStart, effectiveRange.periodEnd),\n      buildExpectedSlotsForTeacher({\n        admin,\n        institutionId,\n        teacherId: teacher.profile_id,\n        periodStart: effectiveRange.periodStart,\n        periodEnd: effectiveRange.periodEnd,\n        classMap,\n        referenceMinutes: sessionReferenceMinutes,\n      }),\n      admin\n        .from("class_teachers")\n        .select("class_id,subject_id,teacher_id,start_date,end_date")\n        .eq("institution_id", institutionId)\n        .eq("teacher_id", teacher.profile_id),\n    ]);\n    if (assignmentsResult.error) throw new Error(assignmentsResult.error.message);\n    const payrollAssignments = (assignmentsResult.data ?? []) as ClassTeacherAssignmentRow[];\n\n    const actualRows = (stats.rows || []).filter((r) => !!r.actual_call_iso || numberValue(r.real_minutes) > 0);\n'''
if text.count(old) != 1:
    raise SystemExit(f'expected payroll Promise.all block once, found {text.count(old)}')
text = text.replace(old, new, 1)

old = '''      if (!classId || !subjectId) return [];\n      const sessionDate = String(row.dateISO || "").slice(0, 10);\n      if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(sessionDate)) return [];\n\n      const cycle = cycleFromLevel(classMap.get(classId)?.level);\n'''
new = '''      if (!classId || !subjectId) return [];\n      const sessionDate = String(row.dateISO || "").slice(0, 10);\n      if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(sessionDate)) return [];\n\n      const assignmentIsValid = payrollAssignments.some((assignment) =>\n        String(assignment.class_id || "") === classId &&\n        String(assignment.subject_id || "") === subjectId &&\n        assignmentCoversDay(assignment, sessionDate),\n      );\n      if (!assignmentIsValid) return [];\n\n      const cycle = cycleFromLevel(classMap.get(classId)?.level);\n'''
if text.count(old) != 1:
    raise SystemExit(f'expected hors EDT validation insertion point once, found {text.count(old)}')
text = text.replace(old, new, 1)

p.write_text(text, encoding='utf-8')
print('payroll hors-EDT assignment guard applied')

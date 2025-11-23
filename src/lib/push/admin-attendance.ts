// src/lib/push/admin-attendance.ts

export type MonitorStatus = "missing" | "late" | "ok";

export type AdminAttendanceEvent = {
  institution_id: string;
  class_id: string;
  class_label: string | null;
  subject_id: string | null;
  subject_name: string | null;
  teacher_id: string;
  teacher_name: string;
  date: string; // "YYYY-MM-DD"
  period_label: string | null;
  planned_start: string | null;
  planned_end: string | null;
  status: MonitorStatus;
  /**
   * minutes de retard par rapport à l'heure de début
   * - "missing_early"  : status = "missing" et late_minutes != null
   * - "missing_final"  : status = "missing" et late_minutes == null
   * - "late"           : status = "late"    et late_minutes > 0
   */
  late_minutes: number | null;
};

export type AdminAttendancePushPayload = {
  kind: "admin_attendance_alert";
  status: MonitorStatus;
  severity: "info" | "warning";
  date: string;
  class_label: string | null;
  subject_name: string | null;
  teacher_name: string;
  period_label: string | null;
  planned_start: string | null;
  planned_end: string | null;
  late_minutes: number | null;
};

/**
 * Construit le payload, le titre et le corps de la notification
 * pour la surveillance des appels côté admin.
 */
export function buildAdminAttendancePushPayload(ev: AdminAttendanceEvent): {
  payload: AdminAttendancePushPayload;
  title: string;
  body: string;
} {
  const classLabel = ev.class_label || "Classe";
  const subjectName = ev.subject_name || "Discipline";

  const timeRange =
    ev.planned_start && ev.planned_end
      ? `${ev.planned_start}–${ev.planned_end}`
      : ev.planned_start
      ? ev.planned_start
      : ev.period_label || "";

  const slotInfo = timeRange ? ` (${timeRange})` : "";

  const isMissing = ev.status === "missing";
  const isLate = ev.status === "late";
  const isEarlyMissing = isMissing && ev.late_minutes !== null;
  const isFinalMissing = isMissing && ev.late_minutes === null;

  let title = "";
  let body = "";

  if (isEarlyMissing) {
    // Phase 1 : après le seuil (15 min) mais pendant le créneau
    title = `Appel non détecté en ${subjectName}`;
    body = `Aucun appel n'a encore été effectué pour la classe ${classLabel} en ${subjectName}${slotInfo} le ${ev.date}. Enseignant : ${ev.teacher_name}.`;
  } else if (isFinalMissing) {
    // Phase 2 : fin de créneau, appel jamais fait
    title = `Appel non effectué en ${subjectName}`;
    body = `L'appel n'a pas été effectué pour la classe ${classLabel} en ${subjectName}${slotInfo} le ${ev.date}. Enseignant : ${ev.teacher_name}.`;
  } else if (isLate) {
    // Appel fait mais en retard
    const delay = Math.max(0, ev.late_minutes ?? 0);
    title = `Appel en retard (${delay} min)`;
    body = `L'appel pour la classe ${classLabel} en ${subjectName}${slotInfo} a été effectué avec ${delay} minute(s) de retard le ${ev.date}. Enseignant : ${ev.teacher_name}.`;
  } else {
    // Sécurité (ne devrait pas arriver normalement)
    title = "Surveillance des appels";
    body = `Un événement de surveillance des appels a été détecté pour la classe ${classLabel} en ${subjectName}${slotInfo} le ${ev.date}. Enseignant : ${ev.teacher_name}.`;
  }

  const severity: "info" | "warning" =
    isMissing || isFinalMissing ? "warning" : "info";

  const payload: AdminAttendancePushPayload = {
    kind: "admin_attendance_alert",
    status: ev.status,
    severity,
    date: ev.date,
    class_label: ev.class_label,
    subject_name: ev.subject_name,
    teacher_name: ev.teacher_name,
    period_label: ev.period_label,
    planned_start: ev.planned_start,
    planned_end: ev.planned_end,
    late_minutes: ev.late_minutes,
  };

  return { payload, title, body };
}

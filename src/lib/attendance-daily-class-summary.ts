// Aggregation locale : aucune requête et aucune écriture depuis cette fonction.
export type DailyAttendanceRow = {
  id: string;
  date: string;
  class_id?: string | null;
  subject_name?: string | null;
  teacher_name?: string | null;
  planned_start?: string | null;
  planned_end?: string | null;
  session_id?: string | null;
  actual_call_at?: string | null;
};

export type DailyAttendanceStatus = "done" | "unreceived" | "ongoing" | "unconfirmed";

export function dailyAttendanceStatus(
  row: DailyAttendanceRow,
  selectedDate: string,
  now = new Date(),
): DailyAttendanceStatus {
  // Un appel enregistré est une preuve de saisie, non une preuve de présence physique.
  if (row.actual_call_at) return "done";
  if (row.session_id) return "unconfirmed";

  // Afrique/Abidjan = UTC (sans changement d'heure).
  const today = now.toISOString().slice(0, 10);
  if (selectedDate > today) return "ongoing";
  if (selectedDate < today) return "unreceived";
  const end = String(row.planned_end || "").slice(0, 5);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(end)) return "unconfirmed";
  const currentTime = now.toISOString().slice(11, 16);
  return currentTime < end ? "ongoing" : "unreceived";
}

export function summarizeDailyAttendance(
  rows: DailyAttendanceRow[],
  selectedDate: string,
  now = new Date(),
) {
  const entries = rows
    .filter((row) => row.date === selectedDate)
    .map((row) => ({ ...row, daily_status: dailyAttendanceStatus(row, selectedDate, now) }))
    .sort((a, b) =>
      String(a.planned_start || "").localeCompare(String(b.planned_start || "")) ||
      String(a.subject_name || "").localeCompare(String(b.subject_name || ""), "fr"),
    );
  return {
    entries,
    planned: entries.length,
    done: entries.filter((row) => row.daily_status === "done").length,
    unreceived: entries.filter((row) => row.daily_status === "unreceived").length,
    pending: entries.filter((row) => row.daily_status === "ongoing" || row.daily_status === "unconfirmed").length,
  };
}

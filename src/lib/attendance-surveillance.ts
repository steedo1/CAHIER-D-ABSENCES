/** Never move a session to another timetable slot because its call was late. */
export function sessionBelongsToSlot(startedMinute: number, plannedMinute: number) {
  return Number.isFinite(startedMinute) && startedMinute === plannedMinute;
}

export type AttendanceReceiptFacts = {
  session_id?: string | null;
  attendance_received_at?: string | null;
  attendance_receipt_available?: boolean;
  ended_at?: string | null;
};

export function attendanceReceiptLabel(row: AttendanceReceiptFacts) {
  if (row.session_id === undefined) return "Réception élèves non vérifiable sur cette source";
  if (!row.session_id) return "Aucune séance reçue";
  if (!row.attendance_receipt_available) return "Réception élèves non vérifiable";
  if (!row.attendance_received_at) return "Séance reçue · réception de l’appel élèves non confirmée";
  return row.ended_at ? "Appel élèves reçu · séance clôturée" : "Appel élèves reçu · séance non clôturée";
}

type PageResult<T> = { data: T[] | null; error: { message: string } | null; count?: number | null };
/** Count-aware paging: never silently certify a truncated response as complete. */
export async function readAttendancePages<T>(
  read: (from: number, to: number) => PromiseLike<PageResult<T>>,
  maxRows = 20_000,
): Promise<PageResult<T>> {
  const data: T[] = [];
  for (;;) {
    const page = await read(data.length, data.length + 199);
    if (page.error) return { data: null, error: page.error };
    const batch = page.data || [];
    data.push(...batch);
    if (page.count != null ? data.length >= page.count : batch.length < 200) {
      return { data, error: null };
    }
    if (!batch.length || data.length >= maxRows) {
      return { data: null, error: { message: "Période trop volumineuse ou réponse incomplète : réduisez la période." } };
    }
  }
}

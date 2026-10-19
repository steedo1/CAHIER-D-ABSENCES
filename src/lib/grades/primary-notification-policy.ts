import type { SupabaseClient } from "@supabase/supabase-js";
import { parsePrimaryEventTitle } from "./primary-evaluation-events";
import { primaryTitleScale } from "./primary-storage-scale";

/** The existing SQL publish trigger also queues legacy marks/missing marks.
 * Primary events use official snapshots only: discard legacy trigger messages
 * at dispatch time, including a worker that picked them during publication. */
export async function filterPrimaryOfficialNotifications<T extends { id: string; payload: unknown }>(service: SupabaseClient, rows: T[]): Promise<T[]> {
  const payload = (row: T): any => {
    if (row.payload && typeof row.payload === "object") return row.payload;
    try { return JSON.parse(String(row.payload)); } catch { return null; }
  };
  const candidates = rows.filter(row => {
    const data = payload(row);
    return ["grade", "grade_missing"].includes(data?.kind || data?.type) &&
      data?.evaluation?.id && data?.publication?.source !== "grade_published_scores";
  });
  if (!candidates.length) return rows;
  const ids = [...new Set(candidates.map(row => String(payload(row).evaluation.id)))];
  const result = await service.from("grade_evaluations").select("id,title").in("id", ids).limit(1001);
  if (result.error || !result.data || result.data.length >= 1001) throw Error("PRIMARY_NOTIFICATION_CONTEXT_UNAVAILABLE");
  const primaryIds = new Set(result.data.filter(row => parsePrimaryEventTitle(row.title) || primaryTitleScale(row.title) !== null).map(row => row.id));
  const suppressed = new Set(candidates.filter(row => primaryIds.has(payload(row).evaluation.id)).map(row => row.id));
  return rows.filter(row => !suppressed.has(row.id));
}

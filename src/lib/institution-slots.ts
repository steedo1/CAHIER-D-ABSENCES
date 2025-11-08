// src/lib/institution-slots.ts
import { SupabaseClient } from "@supabase/supabase-js";

/** Trouve le prochain créneau actif pour la classe (ou par slot_id si fourni) */
export async function resolveSlotForClass(
  srv: SupabaseClient,
  class_id: string,
  slot_id?: string | null
): Promise<null | {
  slot_id: string;
  slot_label: string;
  start_hm: string;             // "HH:MM"
  duration_minutes: number;
  started_at_iso: string;       // datation ISO du jour (Abidjan ~ UTC)
}> {
  if (!class_id) return null;

  // 1) Institution de la classe
  const { data: cls, error: clsErr } = await srv
    .from("classes")
    .select("id,institution_id")
    .eq("id", class_id)
    .maybeSingle();
  if (clsErr || !cls?.institution_id) return null;

  // 2) Créneaux actifs de l’établissement (table à prévoir)
  const { data: slots, error: sErr } = await srv
    .from("institution_session_slots")
    .select("id,label,start_hm,duration_minutes,active,order_index")
    .eq("institution_id", cls.institution_id)
    .eq("active", true)
    .order("start_hm", { ascending: true })
    .order("order_index", { ascending: true });
  if (sErr || !Array.isArray(slots) || slots.length === 0) return null;

  const today = new Date(); // Abidjan = UTC±0, pas de DST → OK pour Date locale
  const nowHM = today.toTimeString().slice(0, 5); // "HH:MM"

  function hmToDate(hm: string) {
    const [HH, MM] = hm.split(":").map((x) => parseInt(x, 10));
    return new Date(today.getFullYear(), today.getMonth(), today.getDate(), HH, MM, 0, 0);
  }

  // Si slot_id fourni → priorité
  let chosen = slots.find((s) => s.id === slot_id) || null;

  // Sinon, slot courant : start_hm <= now < start_hm(next)
  if (!chosen) {
    for (let i = 0; i < slots.length; i++) {
      const cur = slots[i];
      const nxt = slots[i + 1] || null;
      if (cur.start_hm <= nowHM && (!nxt || nowHM < nxt.start_hm)) {
        chosen = cur;
        break;
      }
    }
    // sinon, après le dernier créneau → on prend le dernier
    if (!chosen) chosen = slots[slots.length - 1] || null;
  }

  if (!chosen) return null;

  const startedAt = hmToDate(chosen.start_hm);
  return {
    slot_id: chosen.id,
    slot_label: chosen.label,
    start_hm: chosen.start_hm,
    duration_minutes: Math.max(15, Number(chosen.duration_minutes || 60)),
    started_at_iso: startedAt.toISOString(),
  };
}

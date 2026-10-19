"use client";
import { useEffect, useState } from "react";
import { useSchoolNavigation } from "@/components/admin/SchoolNavigationProvider";
import type { PrimaryEvent } from "@/lib/grades/primary-evaluation-events";
import { parseSchoolCyclesSettings } from "@/lib/school-cycles";

/** Both existing bulletin screens use the same dated calendar and class scope. */
export function usePrimaryBulletinCalendar(classroom: { id: string; level?: string | null } | undefined, year: string, institutionSettings?: unknown) {
  const school = useSchoolNavigation();
  // Correspondant Fichier has its own shell, without the administrator's
  // navigation provider. Reuse the institution settings already authorized and
  // loaded by both bulletin screens; calendar access remains server-checked.
  const settings = school?.settings ?? parseSchoolCyclesSettings(institutionSettings);
  const level = String(classroom?.level || "").replace(/[\s.-]/g, "").toUpperCase();
  const enabled = settings.enabled && settings.enabledCycles.includes("primary") && /^(CP[12]|CE[12]|CM[12])$/.test(level);
  const [calendar, setCalendar] = useState<{ key: string; events: PrimaryEvent[]; error: string }>({ key: "", events: [], error: "" });
  const [selectedPrimaryEventCode, setSelectedPrimaryEventCode] = useState("");
  const key = `${classroom?.id || ""}:${year}`;
  useEffect(() => {
    setSelectedPrimaryEventCode("");
    if (!enabled || !year || !classroom?.id) return;
    const controller = new AbortController();
    fetch("/api/admin/institution/primary-evaluation-events?" + new URLSearchParams({ academic_year: year, class_id: classroom.id }),
      { signal: controller.signal, cache: "no-store" }).then(async response => {
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || "Calendrier indisponible");
        if (!controller.signal.aborted) setCalendar({ key, events: data.events || [], error: "" });
      }).catch(error => { if (!controller.signal.aborted) setCalendar({ key, events: [], error: error.message || "Calendrier indisponible" }); });
    return () => controller.abort();
  }, [enabled, classroom?.id, year, key]);
  const current = calendar.key === key ? calendar : { events: [], error: "" };
  const primaryBulletinEvents = current.events.filter(event => event.printBulletin);
  return { primaryBulletinEvents, selectedPrimaryEventCode, setSelectedPrimaryEventCode,
    usesPrimaryEventBulletins: enabled && current.events.length > 0 && selectedPrimaryEventCode !== "LEGACY",
    primaryCalendarLoading: enabled && !!year && calendar.key !== key,
    primaryCalendarError: enabled ? current.error : "" };
}

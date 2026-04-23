// src/app/api/class/subjects/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SubjectItem = {
  id: string; // institution_subjects.id si possible, sinon subjects.id
  label: string;
};

type SlotSpec = {
  weekday: number; // 1..7 (ISO ; 7 = dimanche)
  startHM: string;
  endHM: string;
};

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set((arr || []).filter(Boolean))) as T[];
}

type PhoneVariants = { variants: string[]; likePatterns: string[] };

function buildPhoneVariants(raw: string): PhoneVariants {
  const t = String(raw || "").trim();
  const digits = t.replace(/\D/g, "");
  const local10 = digits ? digits.slice(-10) : "";
  const localNo0 = local10.replace(/^0/, "");
  const cc = "225";

  const variants = uniq<string>([
    t,
    t.replace(/\s+/g, ""),
    digits,
    `+${digits}`,
    `+${cc}${local10}`,
    `+${cc}${localNo0}`,
    `00${cc}${local10}`,
    `00${cc}${localNo0}`,
    `${cc}${local10}`,
    `${cc}${localNo0}`,
    local10,
    localNo0 ? `0${localNo0}` : "",
  ]);

  const likePatterns = uniq<string>([
    local10 ? `%${local10}%` : "",
    local10 ? `%${cc}${local10}%` : "",
    local10 ? `%+${cc}${local10}%` : "",
    local10 ? `%00${cc}${local10}%` : "",
  ]);

  return { variants, likePatterns };
}

function hmsToMin(hms: string | null | undefined) {
  const s = String(hms || "00:00:00").slice(0, 8);
  const [h, m] = s.split(":").map((n) => parseInt(n, 10));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

function hmInTZ(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

function weekdayInTZ1to7(d: Date, tz: string): number {
  const w = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
  })
    .format(d)
    .toLowerCase();

  const map: Record<string, number> = {
    sun: 7,
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6,
  };

  return map[w] ?? 7;
}

function parseSlot(slotRaw: string | null): SlotSpec | null {
  const slot = String(slotRaw || "").trim();
  if (!slot) return null;
  if (slot.startsWith("closed|")) return null;
  if (slot.startsWith("no-config|")) return null;

  const m = slot.match(/^(\d{1,2})\|(\d{2}:\d{2})\|(\d{2}:\d{2})$/);
  if (!m) return null;

  const weekday = Number(m[1]);
  if (!Number.isFinite(weekday) || weekday < 1 || weekday > 7) return null;

  return {
    weekday,
    startHM: m[2],
    endHM: m[3],
  };
}

async function resolveAutoPeriodIds(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string,
  tz: string,
  slotRaw: string | null
): Promise<string[]> {
  const parsed = parseSlot(slotRaw);

  let weekdayValues: number[] = [];
  let wantedStartMin: number | null = null;
  let wantedEndMin: number | null = null;

  if (parsed) {
    weekdayValues = uniq<number>([parsed.weekday, parsed.weekday === 7 ? 0 : parsed.weekday]);
    wantedStartMin = hmsToMin(`${parsed.startHM}:00`);
    wantedEndMin = hmsToMin(`${parsed.endHM}:00`);
  } else {
    const now = new Date();
    const weekday = weekdayInTZ1to7(now, tz);
    weekdayValues = uniq<number>([weekday, weekday === 7 ? 0 : weekday]);
    const nowMin = hmsToMin(`${hmInTZ(now, tz)}:00`);
    wantedStartMin = nowMin;
    wantedEndMin = null;
  }

  const { data: periods, error: periodsErr } = await srv
    .from("institution_periods")
    .select("id,weekday,start_time,end_time,period_no")
    .eq("institution_id", institutionId)
    .in("weekday", weekdayValues)
    .order("period_no", { ascending: true });

  if (periodsErr) {
    throw periodsErr;
  }

  const rows = (periods || []) as Array<{
    id?: string | null;
    weekday?: number | null;
    start_time?: string | null;
    end_time?: string | null;
  }>;

  if (!rows.length) return [];

  if (parsed && wantedStartMin != null && wantedEndMin != null) {
    const exact = rows.filter((p) => {
      const startMin = hmsToMin(p.start_time);
      const endMin = hmsToMin(p.end_time);
      return startMin === wantedStartMin && endMin === wantedEndMin;
    });

    if (exact.length > 0) {
      return uniq(exact.map((p) => String(p.id || "")).filter(Boolean));
    }

    const covering = rows.filter((p) => {
      const startMin = hmsToMin(p.start_time);
      const endMin = hmsToMin(p.end_time);
      return wantedStartMin >= startMin && wantedStartMin < endMin;
    });

    return uniq(covering.map((p) => String(p.id || "")).filter(Boolean));
  }

  if (wantedStartMin == null) return [];

  const active = rows.filter((p) => {
    const startMin = hmsToMin(p.start_time);
    const endMin = hmsToMin(p.end_time);
    return wantedStartMin >= startMin && wantedStartMin < endMin;
  });

  return uniq(active.map((p) => String(p.id || "")).filter(Boolean));
}

async function mapSubjectIdsToItems(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string,
  rawSubjectIds: string[]
): Promise<SubjectItem[]> {
  const subjectIds = uniq(rawSubjectIds.map((x) => String(x || "").trim()).filter(Boolean));
  if (!subjectIds.length) return [];

  const instRows: any[] = [];
  const instSeen = new Set<string>();

  {
    const { data, error } = await srv
      .from("institution_subjects")
      .select("id,subject_id,custom_name,subjects:subject_id(name)")
      .eq("institution_id", institutionId)
      .in("id", subjectIds);

    if (error) throw error;

    for (const row of data || []) {
      const id = String((row as any)?.id || "").trim();
      if (id && !instSeen.has(id)) {
        instRows.push(row);
        instSeen.add(id);
      }
    }
  }

  {
    const { data, error } = await srv
      .from("institution_subjects")
      .select("id,subject_id,custom_name,subjects:subject_id(name)")
      .eq("institution_id", institutionId)
      .in("subject_id", subjectIds);

    if (error) throw error;

    for (const row of data || []) {
      const id = String((row as any)?.id || "").trim();
      if (id && !instSeen.has(id)) {
        instRows.push(row);
        instSeen.add(id);
      }
    }
  }

  const covered = new Set<string>();
  for (const row of instRows) {
    const instId = String((row as any)?.id || "").trim();
    const canonicalId = String((row as any)?.subject_id || "").trim();
    if (instId) covered.add(instId);
    if (canonicalId) covered.add(canonicalId);
  }

  const leftovers = subjectIds.filter((id) => !covered.has(id));

  const itemsMap = new Map<string, SubjectItem>();

  for (const row of instRows) {
    const id = String((row as any)?.id || "").trim();
    const label = String((row as any)?.custom_name || (row as any)?.subjects?.name || "—").trim();
    if (id && !itemsMap.has(id)) {
      itemsMap.set(id, { id, label: label || "—" });
    }
  }

  if (leftovers.length > 0) {
    const { data, error } = await srv
      .from("subjects")
      .select("id,name")
      .in("id", leftovers);

    if (error) throw error;

    for (const row of data || []) {
      const id = String((row as any)?.id || "").trim();
      const label = String((row as any)?.name || "—").trim();
      if (id && !itemsMap.has(id)) {
        itemsMap.set(id, { id, label: label || "—" });
      }
    }
  }

  return Array.from(itemsMap.values()).sort((a, b) => a.label.localeCompare(b.label, "fr"));
}

async function getLegacySubjectIds(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  classId: string,
  institutionId: string
): Promise<string[]> {
  const ids: string[] = [];

  {
    const { data, error } = await srv
      .from("class_teachers")
      .select("subject_id")
      .eq("class_id", classId);

    if (error) throw error;

    ids.push(
      ...((data || []) as any[])
        .map((row) => String(row?.subject_id || "").trim())
        .filter(Boolean)
    );
  }

  // Fallback supplémentaire : certaines classes ont déjà des notes pour des matières
  // qui ne remontent pas (ou plus) dans class_teachers.
  try {
    const { data, error } = await srv
      .from("grade_flat_marks")
      .select("subject_id")
      .eq("class_id", classId)
      .eq("institution_id", institutionId);

    if (!error) {
      ids.push(
        ...((data || []) as any[])
          .map((row) => String(row?.subject_id || "").trim())
          .filter(Boolean)
      );
    }
  } catch {
    // optionnel : on n'échoue pas si ce fallback n'est pas dispo
  }

  return uniq(ids);
}

export async function GET(req: NextRequest) {
  try {
    const supa = await getSupabaseServerClient();
    const srv = getSupabaseServiceClient();

    const {
      data: { user },
    } = await supa.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const class_id = (url.searchParams.get("class_id") ?? "").trim();
    const slotRaw = (url.searchParams.get("slot") ?? "").trim() || null;

    if (!class_id) {
      return NextResponse.json({ items: [] as SubjectItem[] });
    }

    let phone = String((user as any).phone || "").trim();
    if (!phone) {
      const { data: au } = await srv
        .schema("auth")
        .from("users")
        .select("phone")
        .eq("id", user.id)
        .maybeSingle();
      phone = String(au?.phone || "").trim();
    }

    if (!phone) {
      return NextResponse.json({ error: "no_phone" }, { status: 404 });
    }

    const { variants, likePatterns } = buildPhoneVariants(phone);

    const { data: cls, error: clsErr } = await srv
      .from("classes")
      .select("id,label,institution_id,class_phone_e164")
      .eq("id", class_id)
      .maybeSingle();

    if (clsErr) {
      return NextResponse.json({ error: clsErr.message }, { status: 400 });
    }
    if (!cls) {
      return NextResponse.json({ items: [] as SubjectItem[] });
    }

    let match = false;
    if (cls.class_phone_e164 && variants.includes(String(cls.class_phone_e164))) match = true;
    if (!match && likePatterns.length) {
      const stored = String(cls.class_phone_e164 || "");
      match = likePatterns.some((p) => {
        const pat = String(p).replace(/%/g, ".*");
        try {
          return new RegExp(pat).test(stored);
        } catch {
          return false;
        }
      });
    }

    if (!match) {
      return NextResponse.json({ error: "forbidden_not_class_device" }, { status: 403 });
    }

    const institutionId = String(cls.institution_id || "").trim();
    if (!institutionId) {
      return NextResponse.json({ items: [] as SubjectItem[] });
    }

    const { data: inst, error: instErr } = await srv
      .from("institutions")
      .select("id,tz")
      .eq("id", institutionId)
      .maybeSingle();

    if (instErr) {
      return NextResponse.json({ error: instErr.message }, { status: 400 });
    }

    const tz = String(inst?.tz || "Africa/Abidjan");

    // 1) Nouveau système : si un slot est fourni, on essaie le filtrage strict par créneau/EDT.
    //    Si ça échoue ou que ça ne renvoie rien, on retombera sur l'ancien système.
    if (slotRaw && !slotRaw.startsWith("closed|") && !slotRaw.startsWith("no-config|")) {
      const periodIds = await resolveAutoPeriodIds(srv, institutionId, tz, slotRaw);

      if (periodIds.length > 0) {
        const { data: ttRows, error: ttErr } = await srv
          .from("teacher_timetables")
          .select("subject_id")
          .eq("institution_id", institutionId)
          .eq("class_id", class_id)
          .in("period_id", periodIds);

        if (ttErr) {
          return NextResponse.json({ error: ttErr.message }, { status: 400 });
        }

        const autoSubjectIds = uniq(
          ((ttRows || []) as any[])
            .map((row) => String(row?.subject_id || "").trim())
            .filter(Boolean)
        );

        if (autoSubjectIds.length > 0) {
          const autoItems = await mapSubjectIdsToItems(srv, institutionId, autoSubjectIds);
          if (autoItems.length > 0) {
            return NextResponse.json({ items: autoItems });
          }
        }
      }
    }

    // 2) Ancien système : matières de la classe (fallback en ligne + mode hors ligne)
    const legacySubjectIds = await getLegacySubjectIds(srv, class_id, institutionId);
    if (!legacySubjectIds.length) {
      return NextResponse.json({ items: [] as SubjectItem[] });
    }

    const legacyItems = await mapSubjectIdsToItems(srv, institutionId, legacySubjectIds);
    return NextResponse.json({ items: legacyItems });
  } catch (err: any) {
    console.error("[class.subjects] unexpected error", err);
    return NextResponse.json({ error: err?.message || "class_subjects_failed" }, { status: 500 });
  }
}

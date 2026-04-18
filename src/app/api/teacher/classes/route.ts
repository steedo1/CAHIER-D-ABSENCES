// src/app/api/teacher/classes/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

// On ne se bat pas avec les types générés par Supabase pour les relations : on lit en `any`.
type ItemOut = {
  class_id: string;
  class_label: string;
  level: string;
  subject_id: string | null;   // ⚠️ sera toujours un subjects.id canonique si possible
  subject_name: string | null;
};

type ClassTeacherRaw = {
  class_id: string;
  subject_id: string | null; // en pratique = institution_subjects.id
  classes: {
    label?: string | null;
    level?: string | null;
    institution_id?: string | null;
  } | null;
};

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

export async function GET() {
  try {
    const supa = await getSupabaseServerClient();
    const srv = getSupabaseServiceClient();

    const {
      data: { user },
    } = await supa.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    // classes affectées au prof (+ matière éventuelle)
    const { data, error } = await srv
      .from("class_teachers")
      .select("class_id, subject_id, classes:class_id(label,level,institution_id)")
      .eq("teacher_id", user.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const rawRows = ((data || []) as any[]).filter(Boolean) as ClassTeacherRaw[];
    if (!rawRows.length) {
      return NextResponse.json({ items: [] });
    }

    const institutionIds = Array.from(
      new Set(
        rawRows
          .map((r) => String(r?.classes?.institution_id || "").trim())
          .filter((v) => v.length > 0)
      )
    );

    const now = new Date();
    const activePeriodIdByInstitution = new Map<string, string>();

    if (institutionIds.length > 0) {
      const { data: institutions, error: instErr } = await srv
        .from("institutions")
        .select("id,tz")
        .in("id", institutionIds);

      if (instErr) {
        return NextResponse.json({ error: instErr.message }, { status: 400 });
      }

      const instRows = (institutions || []) as Array<{ id: string; tz?: string | null }>;

      for (const inst of instRows) {
        const tz = String(inst.tz || "Africa/Abidjan");
        const weekday = weekdayInTZ1to7(now, tz);
        const hm = hmInTZ(now, tz);
        const nowMin = hmsToMin(`${hm}:00`);

        const { data: periods, error: perErr } = await srv
          .from("institution_periods")
          .select("id,start_time,end_time")
          .eq("institution_id", inst.id)
          .eq("weekday", weekday)
          .order("period_no", { ascending: true });

        if (perErr) {
          return NextResponse.json({ error: perErr.message }, { status: 400 });
        }

        const active = ((periods || []) as any[]).find((p) => {
          const startMin = hmsToMin(p?.start_time);
          const endMin = hmsToMin(p?.end_time);
          return nowMin >= startMin && nowMin < endMin;
        });

        if (active?.id) {
          activePeriodIdByInstitution.set(String(inst.id), String(active.id));
        }
      }
    }

    const allowedNow = new Set<string>();
    const activePeriodIds = Array.from(new Set([...activePeriodIdByInstitution.values()]));

    if (activePeriodIds.length > 0) {
      const { data: ttRows, error: ttErr } = await srv
        .from("teacher_timetables")
        .select("institution_id,class_id,subject_id,period_id")
        .eq("teacher_id", user.id)
        .in("period_id", activePeriodIds);

      if (ttErr) {
        return NextResponse.json({ error: ttErr.message }, { status: 400 });
      }

      for (const row of (ttRows || []) as any[]) {
        const k = `${String(row.institution_id || "")}|${String(row.class_id || "")}|${String(
          row.subject_id || ""
        )}|${String(row.period_id || "")}`;
        allowedNow.add(k);
      }
    }

    const items: ItemOut[] = [];

    for (const raw of rawRows) {
      const cls = raw.classes as any;
      if (!cls) continue;

      const institutionId = String(cls.institution_id || "").trim();
      const instSubjectId = raw.subject_id ? String(raw.subject_id) : null;
      const activePeriodId = activePeriodIdByInstitution.get(institutionId) || null;

      // ✅ si un créneau est actif pour cette institution, ne remonter QUE ce qui est prévu à ce créneau
      if (activePeriodId) {
        const allowedKey = `${institutionId}|${String(raw.class_id || "")}|${String(
          instSubjectId || ""
        )}|${activePeriodId}`;
        if (!allowedNow.has(allowedKey)) {
          continue;
        }
      }

      let subject_name: string | null = null;
      let subject_id: string | null = instSubjectId;

      if (instSubjectId) {
        const { data: isub } = await srv
          .from("institution_subjects")
          .select("id, subject_id, custom_name, subjects:subject_id(id,name)")
          .or(`id.eq.${instSubjectId},subject_id.eq.${instSubjectId}`)
          .limit(1)
          .maybeSingle();

        if (isub) {
          const anySub = isub as any;
          const subj = (anySub.subjects as any) || {};

          subject_name =
            (anySub.custom_name as string | null) ??
            (subj.name as string | null) ??
            null;

          // ⚠️ Id canonique de la matière : subjects.id si dispo, sinon institution_subjects.subject_id,
          // sinon fallback raw.subject_id
          const canonical =
            (subj.id as string | undefined) ??
            (anySub.subject_id as string | undefined) ??
            (instSubjectId as string | undefined);

          subject_id = canonical ?? null;
        }
      }

      items.push({
        class_id: String(raw.class_id),
        class_label: String(cls.label ?? " "),
        level: String(cls.level ?? " "),
        subject_id,
        subject_name,
      });
    }

    // dé-doublonner (class_id + subject_id)
    const seen = new Set<string>();
    const uniq = items
      .filter((it) => {
        const k = `${it.class_id}|${it.subject_id || ""}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .sort((a, b) =>
        a.class_label.localeCompare(b.class_label, undefined, { numeric: true })
      );

    return NextResponse.json({ items: uniq });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "classes_failed" },
      { status: 400 }
    );
  }
}

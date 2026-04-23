// src/app/api/teacher/classes/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

type ItemOut = {
  class_id: string;
  class_label: string;
  level: string;
  subject_id: string | null;   // id canonique subjects.id si possible
  subject_name: string | null;
};

type ClassTeacherRaw = {
  class_id: string;
  subject_id: string | null; // parfois institution_subjects.id, parfois subjects.id
  classes: {
    label?: string | null;
    level?: string | null;
    institution_id?: string | null;
  } | null;
};

type TimetableRow = {
  institution_id?: string | null;
  class_id?: string | null;
  subject_id?: string | null; // parfois institution_subjects.id, parfois subjects.id
  period_id?: string | null;
};

type SubjectLookup = {
  instSubjectId: string | null;
  canonicalSubjectId: string | null;
  subjectName: string | null;
};

function uniqStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .map((v) => String(v || "").trim())
        .filter((v) => v.length > 0)
    )
  );
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

async function buildSubjectLookup(
  srv: any,
  ids: Array<string | null | undefined>
): Promise<Map<string, SubjectLookup>> {
  const map = new Map<string, SubjectLookup>();
  const uniqIds = uniqStrings(ids);

  if (!uniqIds.length) return map;

  const orExpr = uniqIds
    .flatMap((id) => [`id.eq.${id}`, `subject_id.eq.${id}`])
    .join(",");

  const { data, error } = await srv
    .from("institution_subjects")
    .select("id, subject_id, custom_name, subjects:subject_id(id,name)")
    .or(orExpr);

  if (error) {
    throw error;
  }

  for (const row of (data || []) as any[]) {
    const instSubjectId = String(row?.id || "").trim() || null;
    const subj = (row?.subjects as any) || {};
    const canonicalSubjectId =
      String(subj?.id || row?.subject_id || instSubjectId || "").trim() || null;

    const subjectName =
      (row?.custom_name as string | null) ??
      (subj?.name as string | null) ??
      null;

    const lookup: SubjectLookup = {
      instSubjectId,
      canonicalSubjectId,
      subjectName,
    };

    const keys = uniqStrings([
      instSubjectId,
      row?.subject_id ? String(row.subject_id) : null,
      canonicalSubjectId,
    ]);

    for (const key of keys) {
      map.set(key, lookup);
    }
  }

  return map;
}

function subjectTokens(
  subjectId: string | null | undefined,
  lookup: Map<string, SubjectLookup>
): string[] {
  const raw = String(subjectId || "").trim();
  if (!raw) return [];

  const ref = lookup.get(raw);
  if (!ref) return uniqStrings([raw]);

  return uniqStrings([raw, ref.instSubjectId, ref.canonicalSubjectId]);
}

function dedupeAndSort(items: ItemOut[]): ItemOut[] {
  const seen = new Set<string>();

  return items
    .filter((it) => {
      const k = `${it.class_id}|${it.subject_id || ""}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) =>
      a.class_label.localeCompare(b.class_label, undefined, { numeric: true })
    );
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

    // 1) Affectations réelles du prof
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

    const institutionIds = uniqStrings(
      rawRows.map((r) => r?.classes?.institution_id || null)
    );

    // 2) Déterminer le créneau actif par établissement
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

      for (const inst of (institutions || []) as Array<{ id: string; tz?: string | null }>) {
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

    const activePeriodIds = uniqStrings([...activePeriodIdByInstitution.values()]);

    // 3) Emploi du temps du prof sur les créneaux actifs
    let ttRows: TimetableRow[] = [];
    if (activePeriodIds.length > 0) {
      const { data: ttData, error: ttErr } = await srv
        .from("teacher_timetables")
        .select("institution_id,class_id,subject_id,period_id")
        .eq("teacher_id", user.id)
        .in("period_id", activePeriodIds);

      if (ttErr) {
        return NextResponse.json({ error: ttErr.message }, { status: 400 });
      }

      ttRows = ((ttData || []) as any[]).filter(Boolean) as TimetableRow[];
    }

    // 4) Normaliser les IDs de matière des deux côtés
    const subjectLookup = await buildSubjectLookup(srv, [
      ...rawRows.map((r) => r.subject_id),
      ...ttRows.map((r) => r.subject_id || null),
    ]);

    // Map: institution|class|period -> set de tokens matière acceptés
    const allowedNow = new Map<string, Set<string>>();

    for (const row of ttRows) {
      const institutionId = String(row.institution_id || "").trim();
      const classId = String(row.class_id || "").trim();
      const periodId = String(row.period_id || "").trim();

      if (!institutionId || !classId || !periodId) continue;

      const baseKey = `${institutionId}|${classId}|${periodId}`;

      if (!allowedNow.has(baseKey)) {
        allowedNow.set(baseKey, new Set<string>());
      }

      const bucket = allowedNow.get(baseKey)!;
      const tokens = subjectTokens(row.subject_id || null, subjectLookup);

      if (tokens.length > 0) {
        for (const token of tokens) bucket.add(token);
      } else {
        bucket.add("__ANY_SUBJECT__");
      }
    }

    const fallbackItems: ItemOut[] = [];
    const strictItems: ItemOut[] = [];

    for (const raw of rawRows) {
      const cls = raw.classes as any;
      if (!cls) continue;

      const institutionId = String(cls.institution_id || "").trim();
      const classId = String(raw.class_id || "").trim();
      const rawSubjectId = String(raw.subject_id || "").trim() || null;

      const ref = rawSubjectId ? subjectLookup.get(rawSubjectId) : null;

      const item: ItemOut = {
        class_id: classId,
        class_label: String(cls.label ?? " "),
        level: String(cls.level ?? " "),
        subject_id: ref?.canonicalSubjectId ?? rawSubjectId,
        subject_name: ref?.subjectName ?? null,
      };

      // Toujours garder la base des affectations réelles
      fallbackItems.push(item);

      const activePeriodId = activePeriodIdByInstitution.get(institutionId) || null;

      // Pas de créneau actif trouvé pour cet établissement => on ne bloque pas
      if (!activePeriodId) {
        strictItems.push(item);
        continue;
      }

      const slotKey = `${institutionId}|${classId}|${activePeriodId}`;
      const allowedSubjects = allowedNow.get(slotKey);

      // Créneau actif connu mais rien trouvé dans l'EDT pour cette classe :
      // on laisse le filtre strict échouer ici, mais un fallback global évitera
      // de bloquer complètement le prof.
      if (!allowedSubjects || allowedSubjects.size === 0) {
        continue;
      }

      // Si aucune matière côté affectation, on autorise la classe
      if (!rawSubjectId) {
        strictItems.push(item);
        continue;
      }

      const rawTokens = subjectTokens(rawSubjectId, subjectLookup);
      const matches =
        rawTokens.some((token) => allowedSubjects.has(token)) ||
        allowedSubjects.has("__ANY_SUBJECT__");

      if (matches) {
        strictItems.push(item);
      }
    }

    // 5) Comportement sûr :
    //    - si le filtrage strict marche, on l'utilise ;
    //    - sinon, on retombe sur les vraies affectations du prof.
    const finalItems =
      strictItems.length > 0
        ? dedupeAndSort(strictItems)
        : dedupeAndSort(fallbackItems);

    return NextResponse.json({ items: finalItems });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "classes_failed" },
      { status: 400 }
    );
  }
}
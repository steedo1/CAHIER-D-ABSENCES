// src/app/api/admin/timetables/manual/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ManualItem = {
  weekday: number;
  period_id: string;
  class_ids: string[];
};

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set((arr || []).filter(Boolean))) as T[];
}

function asIntWeekday(v: any): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);

  // accepte 0..6 (JS getDay)
  if (i >= 0 && i <= 6) return i;

  // accepte 1..7 (ISO) -> 7 = dimanche -> 0
  if (i >= 1 && i <= 7) return i === 7 ? 0 : i;

  return null;
}

async function guard(req: NextRequest) {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) {
    return {
      ok: false as const,
      res: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
  }

  const { data: me, error: meErr } = await supa
    .from("profiles")
    .select("id,institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (meErr) {
    return {
      ok: false as const,
      res: NextResponse.json({ error: meErr.message }, { status: 400 }),
    };
  }

  const institution_id = me?.institution_id as string | null;
  if (!institution_id) {
    return {
      ok: false as const,
      res: NextResponse.json(
        {
          error: "no_institution",
          message: "Aucune institution associée à ce compte.",
        },
        { status: 400 }
      ),
    };
  }

  const { data: roleRow } = await supa
    .from("user_roles")
    .select("role")
    .eq("profile_id", user.id)
    .eq("institution_id", institution_id)
    .maybeSingle();

  const role = (roleRow?.role as string | undefined) || "";
  if (!["admin", "super_admin"].includes(role)) {
    return {
      ok: false as const,
      res: NextResponse.json(
        {
          error: "forbidden",
          message: "Droits insuffisants pour gérer les emplois du temps.",
        },
        { status: 403 }
      ),
    };
  }

  return {
    ok: true as const,
    supa,
    srv,
    userId: user.id,
    institution_id,
  };
}

/**
 * GET = métadonnées pour la saisie manuelle :
 * - subject_id (obligatoire)
 * - teacher_id (optionnel) -> renvoie aussi les lignes existantes de ce prof pour cette matière
 *
 * Réponse :
 * {
 *   subject_id,
 *   teachers: [{ id, display_name, phone }],
 *   teacherClasses: [{ teacher_id, class_id, class_label }],
 *   existing: [{ weekday, period_id, class_id, class_label }]
 * }
 */
export async function GET(req: NextRequest) {
  try {
    const g = await guard(req);
    if (!g.ok) return g.res;
    const { srv, institution_id } = g;

    const url = new URL(req.url);
    const subject_id = url.searchParams.get("subject_id");
    const teacher_id = url.searchParams.get("teacher_id");

    if (!subject_id) {
      return NextResponse.json(
        {
          error: "missing_subject",
          message: "Paramètre subject_id requis.",
        },
        { status: 400 }
      );
    }

    // Toutes les classes de l’établissement
    const [{ data: classes }, { data: ctRows }] = await Promise.all([
      srv
        .from("classes")
        .select("id,label")
        .eq("institution_id", institution_id),
      srv
        .from("class_teachers")
        .select("teacher_id,class_id,subject_id")
        .eq("subject_id", subject_id),
    ]);

    const classesById = new Map<string, string>();
    (classes || []).forEach((c: any) => {
      classesById.set(c.id, c.label);
    });

    const filteredCT = (ctRows || []).filter((row: any) =>
      classesById.has(row.class_id)
    );

    const teacherIds = uniq(filteredCT.map((r: any) => r.teacher_id as string));

    let teachers: { id: string; display_name: string; phone: string | null }[] =
      [];
    if (teacherIds.length > 0) {
      const { data: teacherProfiles } = await srv
        .from("profiles")
        .select("id,display_name,phone")
        .in("id", teacherIds);

      teachers = (teacherProfiles || []).map((t: any) => ({
        id: t.id as string,
        display_name: (t.display_name as string) || "(Sans nom)",
        phone: (t.phone as string | null) ?? null,
      }));
    }

    const teacherClasses = filteredCT.map((r: any) => ({
      teacher_id: r.teacher_id as string,
      class_id: r.class_id as string,
      class_label: classesById.get(r.class_id) || "",
    }));

    // Lignes d'emploi du temps existantes pour ce prof + cette matière
    let existing: {
      weekday: number;
      period_id: string;
      class_id: string;
      class_label: string;
    }[] = [];

    if (teacher_id) {
      const { data: ttRows } = await srv
        .from("teacher_timetables")
        .select("weekday,period_id,class_id")
        .eq("institution_id", institution_id)
        .eq("subject_id", subject_id)
        .eq("teacher_id", teacher_id);

      existing = (ttRows || []).map((r: any) => ({
        weekday: r.weekday as number,
        period_id: r.period_id as string,
        class_id: r.class_id as string,
        class_label: classesById.get(r.class_id) || "",
      }));
    }

    return NextResponse.json({
      subject_id,
      teachers,
      teacherClasses,
      existing,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "manual_meta_failed" },
      { status: 500 }
    );
  }
}

/**
 * POST = enregistrement de l'emploi du temps pour un prof + une matière.
 *
 * Body JSON :
 * {
 *   subject_id: string,
 *   teacher_id: string,
 *   items: ManualItem[]
 * }
 *
 * Stratégie :
 *   - on efface toutes les lignes teacher_timetables pour (institution, subject, teacher)
 *   - on insère les nouvelles lignes (une par classe / créneau)
 *
 * FIX IMPORTANT :
 *   - on force weekday = institution_periods.weekday (via period_id)
 *     pour éviter les décalages front (0..5 vs 1..6 etc).
 */
export async function POST(req: NextRequest) {
  try {
    const g = await guard(req);
    if (!g.ok) return g.res;
    const { srv, userId, institution_id } = g;

    const body = (await req.json().catch(() => null)) as
      | {
          subject_id?: string;
          teacher_id?: string;
          items?: ManualItem[];
        }
      | null;

    if (!body) {
      return NextResponse.json(
        { error: "invalid_body", message: "JSON invalide." },
        { status: 400 }
      );
    }

    const subject_id = body.subject_id;
    const teacher_id = body.teacher_id;
    const items = (body.items || []) as ManualItem[];

    if (!subject_id || !teacher_id) {
      return NextResponse.json(
        {
          error: "missing_ids",
          message: "subject_id et teacher_id sont obligatoires.",
        },
        { status: 400 }
      );
    }

    // 1) On prépare la map period_id -> weekday (source de vérité)
    const periodIds = uniq(
      items
        .map((it) => String(it.period_id || ""))
        .filter((x) => x.length > 0)
    );

    const periodWeekdayById = new Map<string, number>();

    if (periodIds.length > 0) {
      const { data: periods, error: perErr } = await srv
        .from("institution_periods")
        .select("id,weekday")
        .eq("institution_id", institution_id)
        .in("id", periodIds);

      if (perErr) {
        return NextResponse.json(
          { error: "periods_fetch_failed", message: perErr.message },
          { status: 400 }
        );
      }

      (periods || []).forEach((p: any) => {
        const pid = String(p.id);
        const wd = asIntWeekday(p.weekday);
        if (wd !== null) periodWeekdayById.set(pid, wd);
      });

      // si certains period_id n'appartiennent pas à l'institution => on bloque (sinon rien ne remontera dans le monitor)
      const missing = periodIds.filter((pid) => !periodWeekdayById.has(pid));
      if (missing.length > 0) {
        return NextResponse.json(
          {
            error: "unknown_periods",
            message:
              "Certains period_id ne correspondent à aucun créneau de cet établissement.",
            period_ids: missing.slice(0, 20),
          },
          { status: 400 }
        );
      }
    }

    // 2) On nettoie d'abord tout l'emploi du temps de ce prof pour cette matière
    const { error: delErr } = await srv
      .from("teacher_timetables")
      .delete()
      .match({ institution_id, subject_id, teacher_id });

    if (delErr) {
      return NextResponse.json(
        {
          error: "delete_failed",
          message: delErr.message,
        },
        { status: 400 }
      );
    }

    // 3) Insertion
    const rowsToInsert: any[] = [];

    for (const it of items) {
      if (!it.period_id) continue;

      // ✅ weekday fiable = weekday du period_id (institution_periods)
      const wdFromPeriod = periodWeekdayById.get(String(it.period_id));
      const weekday = wdFromPeriod ?? asIntWeekday(it.weekday);
      if (weekday === null) continue;

      const classIds = uniq(it.class_ids || []);
      if (!classIds.length) continue;

      for (const class_id of classIds) {
        rowsToInsert.push({
          institution_id,
          class_id,
          subject_id,
          teacher_id,
          weekday,
          period_id: it.period_id,
          created_by: userId,
        });
      }
    }

    if (!rowsToInsert.length) {
      return NextResponse.json({
        ok: true,
        inserted: 0,
        message:
          "Aucun créneau sélectionné : l'emploi du temps de ce professeur pour cette matière a été vidé.",
      });
    }

    const { error: insErr, count } = await srv
      .from("teacher_timetables")
      .insert(rowsToInsert, { count: "exact" });

    if (insErr) {
      return NextResponse.json(
        { ok: false, error: insErr.message },
        { status: 400 }
      );
    }

    const inserted = typeof count === "number" ? count : rowsToInsert.length;

    return NextResponse.json({
      ok: true,
      inserted,
      message: `${inserted} créneaux enregistrés pour ce professeur.`,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "manual_save_failed" },
      { status: 500 }
    );
  }
}

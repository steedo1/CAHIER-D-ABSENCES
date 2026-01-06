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

type ClearSlot = {
  weekday: number; // optionnel côté delete, mais utile pour le debug
  period_id: string;
  class_id: string;
};

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set((arr || []).filter(Boolean))) as T[];
}

function asIntWeekday(v: any): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(6, Math.floor(n)));
}

async function guard(_req: NextRequest) {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const {
    data: { user },
    error: userErr,
  } = await supa.auth.getUser();

  if (userErr) {
    console.warn("[timetables/manual] auth_getUser_err", { error: userErr.message });
  }
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

  const institution_id = (me?.institution_id as string) || null;
  if (!institution_id) {
    return {
      ok: false as const,
      res: NextResponse.json(
        { error: "no_institution", message: "Aucune institution associée." },
        { status: 400 }
      ),
    };
  }

  const { data: roleRow, error: roleErr } = await supa
    .from("user_roles")
    .select("role")
    .eq("profile_id", user.id)
    .eq("institution_id", institution_id)
    .maybeSingle();

  if (roleErr) {
    console.error("[timetables/manual] role_err", { error: roleErr.message });
  }

  const role = (roleRow?.role as string | undefined) || "";
  if (!["admin", "super_admin"].includes(role)) {
    return {
      ok: false as const,
      res: NextResponse.json(
        { error: "forbidden", message: "Droits insuffisants." },
        { status: 403 }
      ),
    };
  }

  return {
    ok: true as const,
    srv,
    userId: user.id as string,
    institution_id,
  };
}

/**
 * GET = meta pour l'édition manuelle d'un emploi du temps (matière + prof).
 * Query: subject_id=...&teacher_id=...
 *
 * IMPORTANT:
 * - subject_id = institution_subjects.id (comme dans /api/admin/timetables/meta)
 * - Source de vérité pour "profs de cette matière" = class_teachers (affectations)
 */
export async function GET(req: NextRequest) {
  try {
    const g = await guard(req);
    if (!g.ok) return g.res;
    const { srv, institution_id } = g;

    const url = new URL(req.url);
    const subject_id = (url.searchParams.get("subject_id") || "").trim();
    const teacher_id = (url.searchParams.get("teacher_id") || "").trim();

    if (!subject_id) {
      return NextResponse.json(
        { error: "missing_subject", message: "subject_id manquant." },
        { status: 400 }
      );
    }

    // 1) Classes de l'établissement (labels)
    const { data: clsRows, error: clsErr } = await srv
      .from("classes")
      .select("id,label")
      .eq("institution_id", institution_id);

    if (clsErr) {
      return NextResponse.json(
        { error: "classes_failed", message: clsErr.message },
        { status: 400 }
      );
    }

    const classesById = new Map<string, string>();
    (clsRows || []).forEach((c: any) =>
      classesById.set(String(c.id), String(c.label || ""))
    );

    // 2) ✅ Affectations (matière + prof + classe) => class_teachers
    //    Ici, subject_id = institution_subjects.id (comme ailleurs dans ton code)
    const { data: ctRows, error: ctErr } = await srv
      .from("class_teachers")
      .select("teacher_id,class_id,end_date")
      .eq("institution_id", institution_id)
      .eq("subject_id", subject_id)
      .is("end_date", null);

    if (ctErr) {
      return NextResponse.json(
        { error: "class_teachers_failed", message: ctErr.message },
        { status: 400 }
      );
    }

    const teacherIds = uniq((ctRows || []).map((r: any) => String(r.teacher_id)));

    // 3) Profils profs
    let teachers: { id: string; display_name: string; phone: string | null }[] = [];
    if (teacherIds.length > 0) {
      const { data: teacherProfiles, error: tpErr } = await srv
        .from("profiles")
        .select("id,display_name,phone")
        .in("id", teacherIds);

      if (tpErr) {
        return NextResponse.json(
          { error: "teachers_failed", message: tpErr.message },
          { status: 400 }
        );
      }

      teachers = (teacherProfiles || [])
        .map((t: any) => ({
          id: String(t.id),
          display_name: (t.display_name as string) || "(Sans nom)",
          phone: (t.phone as string | null) ?? null,
        }))
        .sort((a, b) => a.display_name.localeCompare(b.display_name));
    }

    // 4) Classes par prof (uniquement celles affectées à cette matière)
    const seenTC = new Set<string>();
    const teacherClasses =
      (ctRows || [])
        .map((r: any) => ({
          teacher_id: String(r.teacher_id),
          class_id: String(r.class_id),
          class_label: classesById.get(String(r.class_id)) || "",
        }))
        .filter((x) => {
          const k = `${x.teacher_id}::${x.class_id}`;
          if (seenTC.has(k)) return false;
          seenTC.add(k);
          return true;
        });

    // 5) Existant pour ce prof + matière
    let existing: { weekday: number; period_id: string; class_id: string; class_label: string }[] =
      [];

    if (teacher_id) {
      const { data: ttRows, error: ttErr } = await srv
        .from("teacher_timetables")
        .select("weekday,period_id,class_id")
        .eq("institution_id", institution_id)
        .eq("subject_id", subject_id)
        .eq("teacher_id", teacher_id);

      if (ttErr) {
        return NextResponse.json(
          { error: "existing_failed", message: ttErr.message },
          { status: 400 }
        );
      }

      existing = (ttRows || []).map((r: any) => ({
        weekday: r.weekday as number,
        period_id: String(r.period_id),
        class_id: String(r.class_id),
        class_label: classesById.get(String(r.class_id)) || "",
      }));
    }

    return NextResponse.json({ subject_id, teachers, teacherClasses, existing });
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
 * Body JSON:
 * {
 *   subject_id: string,
 *   teacher_id: string,
 *   items: ManualItem[],
 *   clear_slots?: ClearSlot[] // ✅ NOUVEAU: slots explicitement vidés à supprimer
 * }
 *
 * Stratégie:
 *   - (optionnel) on supprime d'abord les slots "vidés" pour ce cours (subject_id) sans filtrer le teacher_id
 *     => garantit qu'un créneau vide supprime l'ancien cours visible dans la vue par créneau
 *   - on efface ensuite toutes les lignes teacher_timetables pour (institution, subject, teacher)
 *   - on insère les nouvelles lignes (une par classe / créneau)
 *
 * FIX IMPORTANT:
 *   - on force weekday = institution_periods.weekday (via period_id) pour éviter les décalages front.
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
          clear_slots?: ClearSlot[];
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
    const clear_slots = (body.clear_slots || []) as ClearSlot[];

    if (!subject_id || !teacher_id) {
      return NextResponse.json(
        { error: "missing_ids", message: "subject_id et teacher_id sont obligatoires." },
        { status: 400 }
      );
    }

    // ✅ 0) Suppression explicite des créneaux vidés (sans filtre teacher_id)
    for (const s of clear_slots) {
      const class_id = String((s as any)?.class_id || "");
      const period_id = String((s as any)?.period_id || "");
      if (!class_id || !period_id) continue;

      const { error: delSlotErr } = await srv
        .from("teacher_timetables")
        .delete()
        .match({ institution_id, subject_id, class_id, period_id });

      if (delSlotErr) {
        return NextResponse.json(
          {
            error: "clear_slot_failed",
            message: delSlotErr.message,
            slot: { class_id, period_id },
          },
          { status: 400 }
        );
      }
    }

    // 1) Map period_id -> weekday (source de vérité)
    const periodIds = uniq(
      items.map((it) => String(it.period_id || "")).filter((x) => x.length > 0)
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

    // 2) Nettoyage complet pour CE prof + matière
    const { error: delErr } = await srv
      .from("teacher_timetables")
      .delete()
      .match({ institution_id, subject_id, teacher_id });

    if (delErr) {
      return NextResponse.json(
        { error: "delete_failed", message: delErr.message },
        { status: 400 }
      );
    }

    // 3) Insertion
    const rowsToInsert: any[] = [];

    for (const it of items) {
      if (!it.period_id) continue;

      const wdFromPeriod = periodWeekdayById.get(String(it.period_id));
      const weekday = wdFromPeriod ?? asIntWeekday(it.weekday) ?? 0;

      const classIds = uniq((it.class_ids || []).map((x) => String(x)));

      for (const class_id of classIds) {
        rowsToInsert.push({
          institution_id,
          teacher_id,
          subject_id,
          class_id,
          period_id: it.period_id,
          weekday,
          updated_by: userId,
        });
      }
    }

    if (rowsToInsert.length > 0) {
      const { error: insErr } = await srv
        .from("teacher_timetables")
        .insert(rowsToInsert);

      if (insErr) {
        return NextResponse.json(
          { error: "insert_failed", message: insErr.message },
          { status: 400 }
        );
      }
    }

    return NextResponse.json({
      ok: true,
      message: "Emploi du temps enregistré avec succès.",
      inserted: rowsToInsert.length,
      cleared: clear_slots.length,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "manual_save_failed" },
      { status: 500 }
    );
  }
}

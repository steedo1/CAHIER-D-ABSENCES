// src/app/api/admin/institution/periods/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GuardOk = { user: { id: string }; instId: string };
type GuardErr = { error: "unauthorized" | "no_institution" | "forbidden" };

type ProfileRow = {
  id: string;
  role: string | null;
  institution_id: string | null;
};

type UserRoleRow = {
  role: string | null;
  institution_id: string | null;
};

type InstitutionPeriodRow = {
  id: string;
  weekday: number | null;
  period_no: number | null;
  label?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  duration_min?: number | null;
};

type AdminStudentCallRefRow = {
  period_id: string | null;
};

type NormalizedPeriodInput = {
  id?: string;
  weekday: number;
  label: string;
  start_time: string;
  end_time: string;
};

type IncomingPeriod = NormalizedPeriodInput & {
  period_no: number;
};

type ExistingPeriodLite = {
  id: string;
  weekday: number;
  period_no: number;
};

type InsertPayloadRow = {
  institution_id: string;
  weekday: number;
  period_no: number;
  label: string;
  start_time: string;
  end_time: string;
};

async function guard(
  supa: SupabaseClient,
  srv: SupabaseClient
): Promise<GuardOk | GuardErr> {
  const {
    data: { user },
  } = await supa.auth.getUser();

  if (!user) return { error: "unauthorized" };

  const { data: me } = await supa
    .from("profiles")
    .select("id, role, institution_id")
    .eq("id", user.id)
    .maybeSingle();

  const profile = (me ?? null) as ProfileRow | null;

  let instId: string | null = profile?.institution_id ?? null;
  let roleProfile = String(profile?.role || "");

  if (!instId || !["admin", "super_admin"].includes(roleProfile)) {
    const { data: urRows } = await srv
      .from("user_roles")
      .select("role, institution_id")
      .eq("profile_id", user.id);

    const roles = (urRows ?? []) as UserRoleRow[];

    const adminRow = roles.find((r: UserRoleRow) =>
      ["admin", "super_admin"].includes(String(r.role || ""))
    );

    if (adminRow) {
      if (!instId && adminRow.institution_id) {
        instId = String(adminRow.institution_id);
      }
      roleProfile = roleProfile || String(adminRow.role || "");
    }
  }

  const isAdmin = ["admin", "super_admin"].includes(roleProfile);

  if (!instId) return { error: "no_institution" };
  if (!isAdmin) return { error: "forbidden" };

  return { user: { id: user.id }, instId };
}

function guardStatus(err: GuardErr["error"]): number {
  if (err === "unauthorized") return 401;
  if (err === "forbidden") return 403;
  return 400;
}

function isPersistedId(v: unknown): v is string {
  return typeof v === "string" && v.length >= 16 && !v.startsWith("temp_");
}

export async function GET() {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const g = await guard(
    supa as unknown as SupabaseClient,
    srv as unknown as SupabaseClient
  );

  if ("error" in g) {
    return NextResponse.json(
      { error: g.error },
      { status: guardStatus(g.error) }
    );
  }

  const { data, error } = await srv
    .from("institution_periods")
    .select("id, weekday, period_no, label, start_time, end_time, duration_min")
    .eq("institution_id", g.instId)
    .order("weekday", { ascending: true })
    .order("period_no", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    periods: (data ?? []) as InstitutionPeriodRow[],
  });
}

export async function PUT(req: NextRequest) {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const g = await guard(
    supa as unknown as SupabaseClient,
    srv as unknown as SupabaseClient
  );

  if ("error" in g) {
    return NextResponse.json(
      { error: g.error },
      { status: guardStatus(g.error) }
    );
  }

  const body: unknown = await req.json().catch(() => ({}));
  const rawPeriods =
    typeof body === "object" &&
    body !== null &&
    Array.isArray((body as { periods?: unknown[] }).periods)
      ? ((body as { periods: unknown[] }).periods ?? [])
      : [];

  const { data: existingRows, error: existingErr } = await srv
    .from("institution_periods")
    .select("id, weekday, period_no")
    .eq("institution_id", g.instId)
    .order("weekday", { ascending: true })
    .order("period_no", { ascending: true });

  if (existingErr) {
    return NextResponse.json({ error: existingErr.message }, { status: 400 });
  }

  const existing: ExistingPeriodLite[] = (
    (existingRows ?? []) as InstitutionPeriodRow[]
  ).map((r: InstitutionPeriodRow) => ({
    id: String(r.id),
    weekday: Number(r.weekday ?? 0),
    period_no: Number(r.period_no ?? 0),
  }));

  const existingIds = new Set(existing.map((r) => r.id));

  const normBase: NormalizedPeriodInput[] = rawPeriods
    .map((raw: unknown): NormalizedPeriodInput => {
      const p = (raw ?? {}) as {
        id?: unknown;
        weekday?: unknown;
        label?: unknown;
        start_time?: unknown;
        end_time?: unknown;
      };

      return {
        id: typeof p.id === "string" ? p.id : undefined,
        weekday: Math.min(
          6,
          Math.max(0, parseInt(String(p.weekday ?? 0), 10) || 0)
        ),
        label: String(p.label || "").trim() || "Séance",
        start_time: String(p.start_time || "08:00").slice(0, 5) + ":00",
        end_time: String(p.end_time || "09:00").slice(0, 5) + ":00",
      };
    })
    .sort(
      (a: NormalizedPeriodInput, b: NormalizedPeriodInput) =>
        a.weekday - b.weekday ||
        a.start_time.localeCompare(b.start_time)
    );

  let curDay = -1;
  let idx = 0;

  const rows: IncomingPeriod[] = normBase.map(
    (p: NormalizedPeriodInput): IncomingPeriod => {
      if (p.weekday !== curDay) {
        curDay = p.weekday;
        idx = 1;
      } else {
        idx += 1;
      }

      return {
        ...p,
        period_no: idx,
      };
    }
  );

  // Cas : tout supprimer
  if (rows.length === 0) {
    const allExistingIds = existing.map((r) => r.id);

    if (allExistingIds.length > 0) {
      const { data: refs, error: refErr } = await srv
        .from("admin_student_calls")
        .select("period_id")
        .in("period_id", allExistingIds);

      if (refErr) {
        return NextResponse.json({ error: refErr.message }, { status: 400 });
      }

      if (((refs ?? []) as AdminStudentCallRefRow[]).length > 0) {
        return NextResponse.json(
          {
            error:
              "Impossible de supprimer tous les créneaux : certains sont déjà utilisés dans l'historique des appels.",
          },
          { status: 409 }
        );
      }

      const { error: delErr } = await srv
        .from("institution_periods")
        .delete()
        .eq("institution_id", g.instId);

      if (delErr) {
        return NextResponse.json({ error: delErr.message }, { status: 400 });
      }
    }

    return NextResponse.json({
      ok: true,
      inserted: 0,
      updated: 0,
      deleted: existing.length,
    });
  }

  // Si le front n'envoie aucun vrai id alors qu'il existe déjà des créneaux,
  // on refuse pour éviter l'ancien comportement destructif.
  const incomingExistingIds = rows
    .map((r) => r.id)
    .filter((id): id is string => isPersistedId(id) && existingIds.has(id));

  if (existing.length > 0 && incomingExistingIds.length === 0) {
    return NextResponse.json(
      {
        error:
          "Payload incomplet : les identifiants des créneaux existants ne sont pas envoyés par le front. Impossible de mettre à jour proprement sans préserver les références.",
      },
      { status: 409 }
    );
  }

  // Ce qui est absent du payload sera potentiellement supprimé
  const obsoleteIds = existing
    .map((r) => r.id)
    .filter((id) => !incomingExistingIds.includes(id));

  if (obsoleteIds.length > 0) {
    const { data: refs, error: refErr } = await srv
      .from("admin_student_calls")
      .select("period_id")
      .in("period_id", obsoleteIds);

    if (refErr) {
      return NextResponse.json({ error: refErr.message }, { status: 400 });
    }

    if (((refs ?? []) as AdminStudentCallRefRow[]).length > 0) {
      return NextResponse.json(
        {
          error:
            "Impossible de supprimer un ou plusieurs créneaux déjà utilisés dans les appels. Modifiez le créneau existant au lieu de le recréer, ou retirez seulement les créneaux non utilisés.",
        },
        { status: 409 }
      );
    }
  }

  const toUpdate = rows.filter(
    (r) => isPersistedId(r.id) && existingIds.has(r.id)
  );

  const toInsert = rows.filter(
    (r) => !(isPersistedId(r.id) && existingIds.has(r.id))
  );

  // 1) Déplacer temporairement les existants à mettre à jour
  // pour éviter d'éventuelles collisions d'unicité sur (institution_id, weekday, period_no)
  for (let i = 0; i < toUpdate.length; i += 1) {
    const r = toUpdate[i];
    const { error: tempErr } = await srv
      .from("institution_periods")
      .update({
        period_no: 1000 + i,
      })
      .eq("institution_id", g.instId)
      .eq("id", r.id as string);

    if (tempErr) {
      return NextResponse.json({ error: tempErr.message }, { status: 400 });
    }
  }

  // 2) Supprimer les obsolètes non référencés
  let deletedCount = 0;
  if (obsoleteIds.length > 0) {
    const { error: delErr } = await srv
      .from("institution_periods")
      .delete()
      .eq("institution_id", g.instId)
      .in("id", obsoleteIds);

    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 400 });
    }

    deletedCount = obsoleteIds.length;
  }

  // 3) Insérer les nouveaux créneaux
  let insertedCount = 0;
  if (toInsert.length > 0) {
    const payload: InsertPayloadRow[] = toInsert.map((r: IncomingPeriod) => ({
      institution_id: g.instId,
      weekday: r.weekday,
      period_no: r.period_no,
      label: r.label,
      start_time: r.start_time,
      end_time: r.end_time,
    }));

    const { data: inserted, error: insErr } = await srv
      .from("institution_periods")
      .insert(payload)
      .select("id");

    if (insErr) {
      return NextResponse.json({ error: insErr.message }, { status: 400 });
    }

    insertedCount = Array.isArray(inserted) ? inserted.length : payload.length;
  }

  // 4) Remettre les existants mis à jour à leur vraie position
  for (const r of toUpdate) {
    const { error: updErr } = await srv
      .from("institution_periods")
      .update({
        weekday: r.weekday,
        period_no: r.period_no,
        label: r.label,
        start_time: r.start_time,
        end_time: r.end_time,
      })
      .eq("institution_id", g.instId)
      .eq("id", r.id as string);

    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 400 });
    }
  }

  return NextResponse.json({
    ok: true,
    inserted: insertedCount,
    updated: toUpdate.length,
    deleted: deletedCount,
  });
}
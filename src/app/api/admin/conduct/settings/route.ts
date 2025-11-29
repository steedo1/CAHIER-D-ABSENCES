// src/app/api/admin/conduct/settings/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Role = "super_admin" | "admin" | "educator" | string;

type ConductSettingsRow = {
  institution_id: string;
  assiduite_max: number;
  tenue_max: number;
  moralite_max: number;
  discipline_max: number;
  points_per_absent_hour: number;
  absent_hours_zero_threshold: number;
  absent_hours_note_after_threshold: number;
  lateness_mode: "ignore" | "as_hours" | "direct_points";
  lateness_minutes_per_absent_hour: number;
  lateness_points_per_late: number;
};

const DEFAULT_SETTINGS: Omit<ConductSettingsRow, "institution_id"> = {
  assiduite_max: 6,
  tenue_max: 3,
  moralite_max: 4,
  discipline_max: 7,
  points_per_absent_hour: 0.5,
  absent_hours_zero_threshold: 10,
  absent_hours_note_after_threshold: 0,
  lateness_mode: "as_hours",
  lateness_minutes_per_absent_hour: 60,
  lateness_points_per_late: 0.25,
};

/* ───────────────── Contexte LECTURE (teacher autorisé) ───────────────── */

async function getContextForRead() {
  const supabase = await getSupabaseServerClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      error: NextResponse.json(
        { error: "Non authentifié" },
        { status: 401 }
      ),
    } as const;
  }

  // On récupère juste l'établissement lié à ce profil,
  // sans filtrer sur le rôle (teacher compris).
  const { data: ur, error: urError } = await supabase
    .from("user_roles")
    .select("institution_id")
    .eq("profile_id", user.id)
    .limit(1)
    .maybeSingle();

  if (urError || !ur) {
    return {
      error: NextResponse.json(
        { error: "Accès refusé (rôle ou établissement introuvable)" },
        { status: 403 }
      ),
    } as const;
  }

  return {
    supabase,
    user,
    institutionId: ur.institution_id as string,
  } as const;
}

/* ───────────────── Contexte ADMIN (écriture uniquement) ───────────────── */

async function getContext() {
  const supabase = await getSupabaseServerClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      error: NextResponse.json(
        { error: "Non authentifié" },
        { status: 401 }
      ),
    } as const;
  }

  const { data: ur, error: urError } = await supabase
    .from("user_roles")
    .select("institution_id, role")
    .eq("profile_id", user.id)
    .in("role", ["super_admin", "admin", "educator"] as Role[])
    .limit(1)
    .maybeSingle();

  if (urError || !ur) {
    return {
      error: NextResponse.json(
        { error: "Accès refusé (rôle ou établissement introuvable)" },
        { status: 403 }
      ),
    } as const;
  }

  return {
    supabase,
    user,
    institutionId: ur.institution_id as string,
  } as const;
}

/* ───────────────── GET : lecture des réglages (teacher OK) ───────────────── */

export async function GET(_req: NextRequest) {
  const ctx = await getContextForRead();
  if ("error" in ctx) return ctx.error;
  const { institutionId } = ctx;

  // ✅ On lit conduct_settings avec le client service pour bypass la RLS
  const svc = await getSupabaseServiceClient();

  const { data, error } = await svc
    .from("conduct_settings")
    .select(
      [
        "institution_id",
        "assiduite_max",
        "tenue_max",
        "moralite_max",
        "discipline_max",
        "points_per_absent_hour",
        "absent_hours_zero_threshold",
        "absent_hours_note_after_threshold",
        "lateness_mode",
        "lateness_minutes_per_absent_hour",
        "lateness_points_per_late",
      ].join(", ")
    )
    .eq("institution_id", institutionId)
    .maybeSingle();

  console.log("[ConductSettings/GET] institutionId =", institutionId, {
    hasRow: !!data,
    error: (error as any)?.message,
  });

  if (error || !data) {
    // Pas de réglages en BDD → on renvoie les défauts
    console.warn(
      "[ConductSettings/GET] Fallback DEFAULTS pour institutionId",
      institutionId,
      "error=",
      (error as any)?.message
    );
    return NextResponse.json(
      {
        institution_id: institutionId,
        ...DEFAULT_SETTINGS,
      } satisfies ConductSettingsRow,
      { status: 200 }
    );
  }

  // ✅ On caste data pour calmer TypeScript (éviter GenericStringError)
  const row = data as any;

  const payload: ConductSettingsRow = {
    institution_id: row.institution_id,
    assiduite_max:
      Number(row.assiduite_max) ?? DEFAULT_SETTINGS.assiduite_max,
    tenue_max: Number(row.tenue_max) ?? DEFAULT_SETTINGS.tenue_max,
    moralite_max: Number(row.moralite_max) ?? DEFAULT_SETTINGS.moralite_max,
    discipline_max:
      Number(row.discipline_max) ?? DEFAULT_SETTINGS.discipline_max,
    points_per_absent_hour:
      Number(row.points_per_absent_hour) ??
      DEFAULT_SETTINGS.points_per_absent_hour,
    absent_hours_zero_threshold:
      Number(row.absent_hours_zero_threshold) ??
      DEFAULT_SETTINGS.absent_hours_zero_threshold,
    absent_hours_note_after_threshold:
      Number(row.absent_hours_note_after_threshold) ??
      DEFAULT_SETTINGS.absent_hours_note_after_threshold,
    lateness_mode:
      (row.lateness_mode as ConductSettingsRow["lateness_mode"]) ??
      DEFAULT_SETTINGS.lateness_mode,
    lateness_minutes_per_absent_hour:
      Number(row.lateness_minutes_per_absent_hour) ??
      DEFAULT_SETTINGS.lateness_minutes_per_absent_hour,
    lateness_points_per_late:
      Number(row.lateness_points_per_late) ??
      DEFAULT_SETTINGS.lateness_points_per_late,
  };

  return NextResponse.json(payload, { status: 200 });
}

/* ───────────────── POST : sauvegarde / upsert (ADMIN ONLY) ───────────────── */

export async function POST(req: NextRequest) {
  const ctx = await getContext(); // ⚠️ ici on reste sur admin / super_admin / educator
  if ("error" in ctx) return ctx.error;
  const { supabase, institutionId } = ctx;

  let body: Partial<ConductSettingsRow>;
  try {
    body = (await req.json()) ?? {};
  } catch {
    return NextResponse.json(
      { error: "Payload JSON invalide" },
      { status: 400 }
    );
  }

  const parseNumber = (v: unknown, fallback: number) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return fallback;
    return n;
  };

  const assiduite_max = parseNumber(
    body.assiduite_max,
    DEFAULT_SETTINGS.assiduite_max
  );
  const tenue_max = parseNumber(body.tenue_max, DEFAULT_SETTINGS.tenue_max);
  const moralite_max = parseNumber(
    body.moralite_max,
    DEFAULT_SETTINGS.moralite_max
  );
  const discipline_max = parseNumber(
    body.discipline_max,
    DEFAULT_SETTINGS.discipline_max
  );

  const points_per_absent_hour = parseNumber(
    body.points_per_absent_hour,
    DEFAULT_SETTINGS.points_per_absent_hour
  );
  const absent_hours_zero_threshold = parseNumber(
    body.absent_hours_zero_threshold,
    DEFAULT_SETTINGS.absent_hours_zero_threshold
  );

  let absent_hours_note_after_threshold = parseNumber(
    body.absent_hours_note_after_threshold,
    DEFAULT_SETTINGS.absent_hours_note_after_threshold
  );
  // on ne dépasse pas le max d'assiduité
  if (absent_hours_note_after_threshold > assiduite_max) {
    absent_hours_note_after_threshold = assiduite_max;
  }

  const lateness_mode_raw = String(
    body.lateness_mode ?? DEFAULT_SETTINGS.lateness_mode
  )
    .normalize("NFKC")
    .trim()
    .toLowerCase() as ConductSettingsRow["lateness_mode"];

  const lateness_mode: ConductSettingsRow["lateness_mode"] =
    ["ignore", "as_hours", "direct_points"].includes(lateness_mode_raw)
      ? lateness_mode_raw
      : DEFAULT_SETTINGS.lateness_mode;

  const lateness_minutes_per_absent_hour = parseNumber(
    body.lateness_minutes_per_absent_hour,
    DEFAULT_SETTINGS.lateness_minutes_per_absent_hour
  );
  const lateness_points_per_late = parseNumber(
    body.lateness_points_per_late,
    DEFAULT_SETTINGS.lateness_points_per_late
  );

  const payload = {
    institution_id: institutionId,
    assiduite_max,
    tenue_max,
    moralite_max,
    discipline_max,
    points_per_absent_hour,
    absent_hours_zero_threshold,
    absent_hours_note_after_threshold,
    lateness_mode,
    lateness_minutes_per_absent_hour,
    lateness_points_per_late,
    updated_at: new Date().toISOString(),
  };

  console.log("[ConductSettings/POST] payload =", payload);

  const { data, error } = await supabase
    .from("conduct_settings")
    .upsert(payload, { onConflict: "institution_id" })
    .select("*")
    .single();

  if (error) {
    console.error("[ConductSettings/POST] error =", error.message);
    return NextResponse.json(
      { error: error.message ?? "Erreur enregistrement réglages" },
      { status: 500 }
    );
  }

  return NextResponse.json(data as unknown as ConductSettingsRow, {
    status: 200,
  });
}

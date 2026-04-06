import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AbsenceReasonCode =
  | "maladie"
  | "formation"
  | "mission"
  | "evenement_familial"
  | "contrainte_personnelle"
  | "autre";

type BodyPayload = {
  start_date?: string;
  end_date?: string;
  reason_code?: AbsenceReasonCode;
  reason_label?: string;
  details?: string;
  requested_days?: number;
  signed?: boolean;
  source?: string;
};

type ActorContext = {
  userId: string;
  profileId: string;
  institutionId: string;
  displayName: string | null;
};

type AbsenceRequestRow = {
  id: string;
  institution_id: string;
  teacher_user_id: string;
  teacher_profile_id: string;
  start_date: string;
  end_date: string;
  reason_code: string;
  reason_label: string;
  details: string;
  requested_days: number;
  signed: boolean;
  source: string;
  status: "pending" | "approved" | "rejected" | "cancelled" | string;
  admin_comment: string | null;
  approved_at: string | null;
  approved_by: string | null;
  rejected_at: string | null;
  rejected_by: string | null;
  created_at: string;
  updated_at?: string | null;
  lost_hours_total?: number | null;
  lost_sessions_total?: number | null;
  impact_summary?: unknown;
  makeup_plan?: unknown;
};

function isValidDateOnly(v: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(v);
}

function isUuid(v: string | null | undefined) {
  return !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function normalizeText(v: unknown) {
  return String(v ?? "").trim();
}

function diffDaysInclusive(startDate: string, endDate: string) {
  const a = new Date(`${startDate}T00:00:00`);
  const b = new Date(`${endDate}T00:00:00`);
  const ms = b.getTime() - a.getTime();
  return Math.floor(ms / 86400000) + 1;
}

function safeReasonLabel(code: string) {
  switch (code) {
    case "maladie":
      return "Maladie";
    case "formation":
      return "Formation";
    case "mission":
      return "Mission / déplacement";
    case "evenement_familial":
      return "Événement familial";
    case "contrainte_personnelle":
      return "Contrainte personnelle";
    case "autre":
      return "Autre";
    default:
      return "Autre";
  }
}

async function blobToPngDataUrl(blob: Blob | null | undefined): Promise<string | null> {
  try {
    if (!blob || typeof blob.arrayBuffer !== "function") return null;
    const ab = await blob.arrayBuffer();
    const b64 = Buffer.from(ab).toString("base64");
    return b64 ? `data:image/png;base64,${b64}` : null;
  } catch {
    return null;
  }
}

async function resolveTeacherContext() {
  const supabase = await getSupabaseServerClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      ok: false as const,
      status: 401,
      error: "Utilisateur non authentifié.",
    };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, institution_id, display_name")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    return {
      ok: false as const,
      status: 500,
      error: profileError.message || "Impossible de charger le profil enseignant.",
    };
  }

  if (!profile?.id || !profile?.institution_id) {
    return {
      ok: false as const,
      status: 400,
      error:
        "Le profil enseignant est introuvable ou non rattaché à un établissement.",
    };
  }

  const { data: roles, error: rolesError } = await supabase
    .from("user_roles")
    .select("role")
    .eq("profile_id", profile.id)
    .eq("institution_id", profile.institution_id);

  if (rolesError) {
    return {
      ok: false as const,
      status: 500,
      error: rolesError.message || "Impossible de vérifier le rôle utilisateur.",
    };
  }

  const roleValues = (roles ?? []).map((r) => String(r.role ?? "").toLowerCase());
  if (!roleValues.includes("teacher")) {
    return {
      ok: false as const,
      status: 403,
      error: "Ce compte n’est pas autorisé à soumettre une demande d’absence.",
    };
  }

  return {
    ok: true as const,
    supabase,
    actor: {
      userId: user.id,
      profileId: profile.id,
      institutionId: String(profile.institution_id),
      displayName: profile.display_name ?? null,
    } satisfies ActorContext,
  };
}

export async function GET() {
  const ctx = await resolveTeacherContext();

  if (!ctx.ok) {
    return NextResponse.json({ ok: false, error: ctx.error }, { status: ctx.status });
  }

  const { supabase, actor } = ctx;
  const srv = getSupabaseServiceClient() as unknown as SupabaseClient;

  const { data, error } = await supabase
    .from("teacher_absence_requests")
    .select(`
      id,
      institution_id,
      teacher_user_id,
      teacher_profile_id,
      start_date,
      end_date,
      reason_code,
      reason_label,
      details,
      requested_days,
      signed,
      source,
      status,
      admin_comment,
      approved_at,
      approved_by,
      rejected_at,
      rejected_by,
      created_at,
      updated_at,
      lost_hours_total,
      lost_sessions_total,
      impact_summary,
      makeup_plan
    `)
    .eq("institution_id", actor.institutionId)
    .eq("teacher_profile_id", actor.profileId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message || "Chargement impossible." },
      { status: 500 }
    );
  }

  const rows = ((data ?? []) as AbsenceRequestRow[]).map((row) => ({ ...row }));

  const relatedProfileIds = Array.from(
    new Set(
      rows
        .flatMap((row) => [row.approved_by, row.rejected_by])
        .filter((id): id is string => isUuid(id))
    )
  );

  const profileNameById = new Map<string, string>();
  if (relatedProfileIds.length) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", relatedProfileIds);

    for (const p of (profiles ?? []) as Array<{ id: string; display_name?: string | null }>) {
      if (p?.id) profileNameById.set(String(p.id), String(p.display_name ?? "").trim());
    }
  }

  let teacherSignatureStoragePath: string | null = null;
  let teacherSignaturePng: string | null = null;

  const { data: teacherSignatureRow } = await srv
    .from("teacher_signatures")
    .select("storage_path")
    .eq("institution_id", actor.institutionId)
    .eq("teacher_id", actor.profileId)
    .maybeSingle();

  teacherSignatureStoragePath = String((teacherSignatureRow as any)?.storage_path ?? "") || null;

  if (teacherSignatureStoragePath) {
    const { data: sigBlob, error: sigError } = await srv.storage
      .from("signatures")
      .download(teacherSignatureStoragePath);

    if (!sigError && sigBlob) {
      teacherSignaturePng = await blobToPngDataUrl(sigBlob as Blob);
    }
  }

  const items = rows.map((row) => ({
    ...row,
    teacher_name: actor.displayName ?? null,
    teacher_signature_storage_path: teacherSignatureStoragePath,
    teacher_signature_png: teacherSignaturePng,
    approved_by_name: row.approved_by ? profileNameById.get(row.approved_by) ?? null : null,
    rejected_by_name: row.rejected_by ? profileNameById.get(row.rejected_by) ?? null : null,
  }));

  return NextResponse.json({ ok: true, items });
}

export async function POST(req: NextRequest) {
  const ctx = await resolveTeacherContext();

  if (!ctx.ok) {
    return NextResponse.json({ ok: false, error: ctx.error }, { status: ctx.status });
  }

  const { supabase, actor } = ctx;
  const body = (await req.json().catch(() => null)) as BodyPayload | null;

  if (!body) {
    return NextResponse.json(
      { ok: false, error: "Corps de requête invalide." },
      { status: 400 }
    );
  }

  const startDate = normalizeText(body.start_date);
  const endDate = normalizeText(body.end_date);
  const reasonCode = normalizeText(body.reason_code);
  const details = normalizeText(body.details);
  const source = normalizeText(body.source) || "teacher_portal";

  if (!startDate || !endDate) {
    return NextResponse.json(
      { ok: false, error: "Les dates de début et de fin sont obligatoires." },
      { status: 400 }
    );
  }

  if (!isValidDateOnly(startDate) || !isValidDateOnly(endDate)) {
    return NextResponse.json(
      { ok: false, error: "Format de date invalide." },
      { status: 400 }
    );
  }

  if (!reasonCode) {
    return NextResponse.json(
      { ok: false, error: "Le motif principal est obligatoire." },
      { status: 400 }
    );
  }

  if (!details || details.length < 8) {
    return NextResponse.json(
      { ok: false, error: "Veuillez préciser le motif de l’absence." },
      { status: 400 }
    );
  }

  const startMs = new Date(`${startDate}T00:00:00`).getTime();
  const endMs = new Date(`${endDate}T00:00:00`).getTime();

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    return NextResponse.json(
      { ok: false, error: "La période d’absence est invalide." },
      { status: 400 }
    );
  }

  const computedDays = diffDaysInclusive(startDate, endDate);

  if (body.signed) {
    const { data: signature, error: signatureError } = await supabase
      .from("teacher_signatures")
      .select("id, teacher_id, storage_path, updated_at")
      .eq("institution_id", actor.institutionId)
      .eq("teacher_id", actor.profileId)
      .maybeSingle();

    if (signatureError) {
      return NextResponse.json(
        {
          ok: false,
          error:
            signatureError.message ||
            "Impossible de vérifier la signature enseignant.",
        },
        { status: 500 }
      );
    }

    if (!signature?.id) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Aucune signature enregistrée pour ce compte enseignant. Veuillez d’abord enregistrer votre signature.",
        },
        { status: 400 }
      );
    }
  }

  const insertPayload = {
    institution_id: actor.institutionId,
    teacher_user_id: actor.userId,
    teacher_profile_id: actor.profileId,
    start_date: startDate,
    end_date: endDate,
    reason_code: reasonCode,
    reason_label: normalizeText(body.reason_label) || safeReasonLabel(reasonCode),
    details,
    requested_days: computedDays,
    signed: !!body.signed,
    source,
    status: "pending",
  };

  const { data: inserted, error: insertError } = await supabase
    .from("teacher_absence_requests")
    .insert(insertPayload)
    .select(`
      id,
      institution_id,
      teacher_user_id,
      teacher_profile_id,
      start_date,
      end_date,
      reason_code,
      reason_label,
      details,
      requested_days,
      signed,
      source,
      status,
      created_at
    `)
    .single();

  if (insertError) {
    return NextResponse.json(
      {
        ok: false,
        error:
          insertError.message ||
          "La demande n’a pas pu être enregistrée pour le moment.",
      },
      { status: 500 }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      item: inserted,
      message: "Demande d’autorisation d’absence enregistrée avec succès.",
    },
    { status: 201 }
  );
}

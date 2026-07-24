import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import {
  attendanceClassContextIsComplete,
  resolveAttendanceEducationContext,
} from "@/lib/education-attendance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AllowedRole = "admin" | "super_admin" | "educator";

function toYMD(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

async function requireActor() {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const {
    data: { user },
  } = await supa.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }

  const { data: me, error: meErr } = await supa
    .from("profiles")
    .select("id,institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (meErr) {
    return { error: NextResponse.json({ error: meErr.message }, { status: 400 }) };
  }

  const institution_id = String(me?.institution_id || "");
  if (!institution_id) {
    return {
      error: NextResponse.json(
        { error: "no_institution", message: "Aucune institution associée." },
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

  const role = String(roleRow?.role || "") as AllowedRole | "";
  if (!["admin", "super_admin", "educator"].includes(role)) {
    return {
      error: NextResponse.json(
        { error: "forbidden", message: "Droits insuffisants pour cette vue." },
        { status: 403 }
      ),
    };
  }

  return { supa, srv, institution_id, user_id: user.id, role };
}

export async function POST(req: NextRequest) {
  const auth = await requireActor();
  if ("error" in auth) return auth.error;

  const { srv, institution_id, user_id, role } = auth;

  const body = await req.json().catch(() => ({}));
  const class_id = String(body?.class_id || "").trim();
  const period_id = String(body?.period_id || "").trim();
  const call_date = String(body?.call_date || "").trim() || toYMD(new Date());

  if (!class_id || !period_id) {
    return NextResponse.json(
      { error: "invalid_payload", message: "class_id et period_id sont requis." },
      { status: 400 }
    );
  }

  const [
    { data: cls, error: cErr },
    { data: period, error: pErr },
    { data: existing, error: eErr },
  ] = await Promise.all([
    srv
      .from("classes")
      .select(
        "id,label,level,institution_id,education_type,formation_code,formation_level_code",
      )
      .eq("institution_id", institution_id)
      .eq("id", class_id)
      .maybeSingle(),
    srv
      .from("institution_periods")
      .select("id,label,start_time,end_time,institution_id")
      .eq("institution_id", institution_id)
      .eq("id", period_id)
      .maybeSingle(),
    srv
      .from("admin_student_calls")
      .select("id,class_id,period_id,call_date,started_at,actual_call_at,ended_at")
      .eq("institution_id", institution_id)
      .eq("class_id", class_id)
      .eq("period_id", period_id)
      .eq("call_date", call_date)
      .maybeSingle(),
  ]);

  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 400 });
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 400 });
  if (eErr) return NextResponse.json({ error: eErr.message }, { status: 400 });

  if (!cls) {
    return NextResponse.json(
      { error: "class_not_found", message: "Classe introuvable." },
      { status: 404 }
    );
  }
  if (!period) {
    return NextResponse.json(
      { error: "period_not_found", message: "Créneau introuvable." },
      { status: 404 }
    );
  }

  if (
    !attendanceClassContextIsComplete({
      educationType: (cls as any).education_type,
      formationCode: (cls as any).formation_code,
      formationLevelCode: (cls as any).formation_level_code,
    })
  ) {
    return NextResponse.json(
      {
        error: "class_education_context_incomplete",
        message:
          "Cette classe doit être rattachée à une formation et à une année de formation avant l’appel.",
      },
      { status: 409 },
    );
  }

  const { data: institution } = await srv
    .from("institutions")
    .select("settings_json")
    .eq("id", institution_id)
    .maybeSingle();

  const educationContext = resolveAttendanceEducationContext({
    educationType: (cls as any).education_type,
    formationCode: (cls as any).formation_code,
    formationLevelCode: (cls as any).formation_level_code,
    classLevel: (cls as any).level,
    settingsJson: (institution as any)?.settings_json,
  });
  const educationPayload = {
    education_type: educationContext.education_type,
    education_label: educationContext.education_label,
    formation_code: educationContext.formation_code,
    formation_label: educationContext.formation_label,
    formation_level_code: educationContext.formation_level_code,
    formation_level_label: educationContext.formation_level_label,
    education_context_label: educationContext.context_label,
  };

  const nowIso = new Date().toISOString();

  if (existing) {
    const { data: updated, error: uErr } = await srv
      .from("admin_student_calls")
      .update({
        actor_profile_id: user_id,
        actor_role: role,
        actual_call_at: nowIso,
        ended_at: null,
      })
      .eq("id", existing.id)
      .select("id,class_id,period_id,call_date,started_at,actual_call_at")
      .maybeSingle();

    if (uErr) {
      return NextResponse.json({ error: uErr.message }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      item: {
        id: String(updated?.id || existing.id),
        class_id: String(cls.id),
        class_label: String(cls.label || "Classe"),
        period_id: String(period.id),
        period_label: String(period.label || "Séance"),
        call_date,
        started_at: String(updated?.started_at || existing.started_at || nowIso),
        actual_call_at: String(updated?.actual_call_at || nowIso),
        ...educationPayload,
      },
      reused: true,
    });
  }

  const { data: inserted, error: iErr } = await srv
    .from("admin_student_calls")
    .insert({
      institution_id,
      class_id,
      period_id,
      call_date,
      actor_profile_id: user_id,
      actor_role: role,
      started_at: nowIso,
      actual_call_at: nowIso,
    })
    .select("id,class_id,period_id,call_date,started_at,actual_call_at")
    .maybeSingle();

  if (iErr) {
    return NextResponse.json({ error: iErr.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    item: {
      id: String(inserted?.id || ""),
      class_id: String(cls.id),
      class_label: String(cls.label || "Classe"),
      period_id: String(period.id),
      period_label: String(period.label || "Séance"),
      call_date,
      started_at: String(inserted?.started_at || nowIso),
      actual_call_at: String(inserted?.actual_call_at || nowIso),
      ...educationPayload,
    },
  });
}

// src/app/api/teacher/institution/basics/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { createRelayAttendanceAccessToken } from "@/lib/attendance-presence-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AttendancePresencePolicyRow = {
  enabled?: boolean | null;
  teacher_accounts_only?: boolean | null;
  allow_local_relay?: boolean | null;
  allow_gps_fallback?: boolean | null;
  relay_local_url?: string | null;
  max_gps_accuracy_m?: number | null;
  gps_grace_m?: number | null;
  relay_presence_secret?: string | null;
};

export async function GET() {
  // ✅ IMPORTANT : attendre le client
  const supabase = await getSupabaseServerClient();
  const service = getSupabaseServiceClient();

  // 1) Qui est connecté ?
  const { data: me, error: uerr } = await supabase.auth.getUser();
  if (uerr || !me?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 2) Institution du profil
  const { data: prof, error: perr } = await supabase
    .from("profiles")
    .select("institution_id")
    .eq("id", me.user.id)
    .maybeSingle();

  if (perr) {
    return NextResponse.json({ error: perr.message }, { status: 400 });
  }
  if (!prof?.institution_id) {
    // Fallback très safe
    return NextResponse.json({
      tz: "Africa/Abidjan",
      default_session_minutes: 60,
      auto_lateness: true,
      periods: [],
    });
  }

  const instId = prof.institution_id;

  // 3) Paramètres d’établissement
  const { data: inst, error: ierr } = await supabase
    .from("institutions")
    .select("tz, default_session_minutes, auto_lateness")
    .eq("id", instId)
    .maybeSingle();

  if (ierr) {
    return NextResponse.json({ error: ierr.message }, { status: 400 });
  }

  // 4) Créneaux (tous les jours), triés
  const { data: periods, error: perr2 } = await supabase
    .from("institution_periods")
    .select("id, weekday, label, start_time, end_time")
    .eq("institution_id", instId)
    .order("weekday", { ascending: true })
    .order("start_time", { ascending: true });

  if (perr2) {
    return NextResponse.json({ error: perr2.message }, { status: 400 });
  }

  const [policyResult, zonesResult, rolesResult] = await Promise.all([
    service
      .from("institution_attendance_policies")
      .select(
        "enabled,teacher_accounts_only,allow_local_relay,allow_gps_fallback,relay_local_url,max_gps_accuracy_m,gps_grace_m,relay_presence_secret",
      )
      .eq("institution_id", instId)
      .maybeSingle(),
    service
      .from("institution_attendance_zones")
      .select("id,name,latitude,longitude,radius_m,is_active")
      .eq("institution_id", instId)
      .eq("is_active", true),
    service
      .from("user_roles")
      .select("role")
      .eq("profile_id", me.user.id)
      .eq("institution_id", instId),
  ]);

  const migrationMissing =
    (policyResult.error as any)?.code === "42P01" ||
    (zonesResult.error as any)?.code === "42P01";
  if (!migrationMissing && (policyResult.error || zonesResult.error)) {
    return NextResponse.json(
      { error: policyResult.error?.message || zonesResult.error?.message || "presence_settings_failed" },
      { status: 500 },
    );
  }
  if (rolesResult.error) {
    return NextResponse.json({ error: rolesResult.error.message }, { status: 500 });
  }

  const presencePolicy = (policyResult.data || {}) as AttendancePresencePolicyRow;
  const isTeacher = (rolesResult.data || []).some(
    (row: any) => String(row.role || "") === "teacher",
  );
  const relayEnabled =
    !migrationMissing &&
    isTeacher &&
    presencePolicy.enabled === true &&
    presencePolicy.allow_local_relay !== false &&
    String(presencePolicy.relay_presence_secret || "").length >= 32 &&
    Boolean(String(presencePolicy.relay_local_url || "").trim());
  const relayAccessToken = relayEnabled
    ? createRelayAttendanceAccessToken({
        secret: String(presencePolicy.relay_presence_secret || ""),
        institutionId: String(instId),
        actorProfileId: me.user.id,
      })
    : null;

  return NextResponse.json({
    institution_id: instId,
    actor_profile_id: me.user.id,
    tz: inst?.tz ?? "Africa/Abidjan",
    default_session_minutes: Number(inst?.default_session_minutes ?? 60),
    auto_lateness: !!inst?.auto_lateness,
    periods: periods ?? [],
    attendance_presence: {
      enabled: migrationMissing ? false : isTeacher && presencePolicy.enabled === true,
      teacher_accounts_only: true,
      allow_local_relay: presencePolicy.allow_local_relay !== false,
      allow_gps_fallback: presencePolicy.allow_gps_fallback !== false,
      relay_local_url: relayEnabled ? String(presencePolicy.relay_local_url) : null,
      relay_access_token: relayAccessToken,
      max_gps_accuracy_m: Number(presencePolicy.max_gps_accuracy_m || 60),
      gps_grace_m: Number(presencePolicy.gps_grace_m || 25),
      zones: migrationMissing ? [] : zonesResult.data || [],
    },
  });
}

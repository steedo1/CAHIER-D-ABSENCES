import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TandemScope = "disabled" | "all_classes" | "selected_classes";
type TandemMode = "parallel" | "rotation";
type EpsHotHourMode = "disabled" | "soft" | "strict";

type RulesPayload = Partial<{
  avoidBreakInsideMultiPeriodBlock: boolean;
  enablePcSvtTandem: boolean;
  pcSvtTandemScope: TandemScope;
  pcSvtTandemMode: TandemMode;
  pcSvtTandemClassIds: string[];
  allowPcInOrdinaryRoomWhenNoLab: boolean;
  allowSvtInOrdinaryRoomWhenNoLab: boolean;
  allowEpsInOrdinaryRoomWhenNoField: boolean;
  allowComputerInOrdinaryRoomWhenNoLab: boolean;
  treatSportsFieldAsSharedResource: boolean;
  epsMaxSimultaneousCoursesPerField: number;
  epsHotHourMode: EpsHotHourMode;
  avoidStudentGaps: boolean;
  avoidTeacherGaps: boolean;
  avoidSingleHourReturn: boolean;
  avoidHeavySubjectsBackToBack: boolean;
  avoidSameSubjectSameDay: boolean;
  balanceHalfDays: boolean;
  preferMainClassRoom: boolean;
}>;

const DEFAULT_RULES = {
  avoidBreakInsideMultiPeriodBlock: true,
  enablePcSvtTandem: false,
  pcSvtTandemScope: "disabled" as TandemScope,
  pcSvtTandemMode: "parallel" as TandemMode,
  pcSvtTandemClassIds: [] as string[],
  allowPcInOrdinaryRoomWhenNoLab: true,
  allowSvtInOrdinaryRoomWhenNoLab: true,
  allowEpsInOrdinaryRoomWhenNoField: false,
  allowComputerInOrdinaryRoomWhenNoLab: true,
  treatSportsFieldAsSharedResource: true,
  epsMaxSimultaneousCoursesPerField: 2,
  epsHotHourMode: "soft" as EpsHotHourMode,
  avoidStudentGaps: true,
  avoidTeacherGaps: true,
  avoidSingleHourReturn: true,
  avoidHeavySubjectsBackToBack: true,
  avoidSameSubjectSameDay: true,
  balanceHalfDays: true,
  preferMainClassRoom: true,
};

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function bool(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function intInRange(value: unknown, fallback: number, min: number, max: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const text = clean(value);
  return allowed.includes(text as T) ? (text as T) : fallback;
}

function normalizeRules(input: unknown) {
  const raw = (input && typeof input === "object" ? input : {}) as RulesPayload;
  const enableTandem = bool(raw.enablePcSvtTandem, DEFAULT_RULES.enablePcSvtTandem);
  const scope = enableTandem
    ? oneOf(raw.pcSvtTandemScope, ["all_classes", "selected_classes"] as const, "all_classes")
    : "disabled";

  return {
    avoidBreakInsideMultiPeriodBlock: bool(
      raw.avoidBreakInsideMultiPeriodBlock,
      DEFAULT_RULES.avoidBreakInsideMultiPeriodBlock,
    ),
    enablePcSvtTandem: enableTandem,
    pcSvtTandemScope: scope as TandemScope,
    pcSvtTandemMode: oneOf(raw.pcSvtTandemMode, ["parallel", "rotation"] as const, "parallel"),
    pcSvtTandemClassIds: Array.isArray(raw.pcSvtTandemClassIds)
      ? raw.pcSvtTandemClassIds.map(String).filter(Boolean)
      : [],
    allowPcInOrdinaryRoomWhenNoLab: bool(
      raw.allowPcInOrdinaryRoomWhenNoLab,
      DEFAULT_RULES.allowPcInOrdinaryRoomWhenNoLab,
    ),
    allowSvtInOrdinaryRoomWhenNoLab: bool(
      raw.allowSvtInOrdinaryRoomWhenNoLab,
      DEFAULT_RULES.allowSvtInOrdinaryRoomWhenNoLab,
    ),
    allowEpsInOrdinaryRoomWhenNoField: bool(
      raw.allowEpsInOrdinaryRoomWhenNoField,
      DEFAULT_RULES.allowEpsInOrdinaryRoomWhenNoField,
    ),
    allowComputerInOrdinaryRoomWhenNoLab: bool(
      raw.allowComputerInOrdinaryRoomWhenNoLab,
      DEFAULT_RULES.allowComputerInOrdinaryRoomWhenNoLab,
    ),
    treatSportsFieldAsSharedResource: bool(
      raw.treatSportsFieldAsSharedResource,
      DEFAULT_RULES.treatSportsFieldAsSharedResource,
    ),
    epsMaxSimultaneousCoursesPerField: intInRange(
      raw.epsMaxSimultaneousCoursesPerField,
      DEFAULT_RULES.epsMaxSimultaneousCoursesPerField,
      1,
      8,
    ),
    epsHotHourMode: oneOf(raw.epsHotHourMode, ["disabled", "soft", "strict"] as const, DEFAULT_RULES.epsHotHourMode),
    avoidStudentGaps: bool(raw.avoidStudentGaps, DEFAULT_RULES.avoidStudentGaps),
    avoidTeacherGaps: bool(raw.avoidTeacherGaps, DEFAULT_RULES.avoidTeacherGaps),
    avoidSingleHourReturn: bool(raw.avoidSingleHourReturn, DEFAULT_RULES.avoidSingleHourReturn),
    avoidHeavySubjectsBackToBack: bool(
      raw.avoidHeavySubjectsBackToBack,
      DEFAULT_RULES.avoidHeavySubjectsBackToBack,
    ),
    avoidSameSubjectSameDay: bool(raw.avoidSameSubjectSameDay, DEFAULT_RULES.avoidSameSubjectSameDay),
    balanceHalfDays: bool(raw.balanceHalfDays, DEFAULT_RULES.balanceHalfDays),
    preferMainClassRoom: bool(raw.preferMainClassRoom, DEFAULT_RULES.preferMainClassRoom),
  };
}

async function guardAdmin() {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const {
    data: { user },
  } = await supa.auth.getUser();

  if (!user) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, error: "unauthorized", message: "Utilisateur non connecté." },
        { status: 401 },
      ),
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
      response: NextResponse.json(
        { ok: false, error: "profile_failed", message: meErr.message },
        { status: 400 },
      ),
    };
  }

  const institutionId = me?.institution_id ? String(me.institution_id) : "";
  if (!institutionId) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, error: "no_institution", message: "Aucune institution associée à ce compte." },
        { status: 400 },
      ),
    };
  }

  const { data: roleRow, error: roleErr } = await supa
    .from("user_roles")
    .select("role")
    .eq("profile_id", user.id)
    .eq("institution_id", institutionId)
    .maybeSingle();

  if (roleErr) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, error: "role_failed", message: roleErr.message },
        { status: 400 },
      ),
    };
  }

  if (!["admin", "super_admin"].includes(String(roleRow?.role || ""))) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, error: "forbidden", message: "Droits insuffisants." },
        { status: 403 },
      ),
    };
  }

  return { ok: true as const, srv, userId: user.id, institutionId };
}

export async function GET() {
  try {
    const guard = await guardAdmin();
    if (!guard.ok) return guard.response;

    const [rulesRes, classesRes, resourcesRes] = await Promise.all([
      guard.srv
        .from("montage_timetable_terrain_rules")
        .select("id,rules,updated_at")
        .eq("institution_id", guard.institutionId)
        .maybeSingle(),
      guard.srv
        .from("classes")
        .select("id,label,level")
        .eq("institution_id", guard.institutionId)
        .order("label", { ascending: true }),
      guard.srv
        .from("montage_timetable_resources")
        .select("id,resource_type,is_active")
        .eq("institution_id", guard.institutionId),
    ]);

    const firstError = rulesRes.error || classesRes.error || resourcesRes.error;
    if (firstError) {
      return NextResponse.json(
        { ok: false, error: "terrain_rules_fetch_failed", message: firstError.message },
        { status: 400 },
      );
    }

    const resources = resourcesRes.data || [];
    const activeResources = resources.filter((item: any) => item.is_active !== false);

    return NextResponse.json({
      ok: true,
      rules: normalizeRules(rulesRes.data?.rules || {}),
      updated_at: rulesRes.data?.updated_at || null,
      classes: (classesRes.data || []).map((item: any) => ({
        id: String(item.id),
        label: String(item.label || "Classe"),
        level: item.level ? String(item.level) : null,
      })),
      stats: {
        classes: (classesRes.data || []).length,
        pc_labs: activeResources.filter((item: any) => item.resource_type === "pc_lab").length,
        svt_labs: activeResources.filter((item: any) => item.resource_type === "svt_lab").length,
        sports_fields: activeResources.filter((item: any) => item.resource_type === "sports_field").length,
        computer_labs: activeResources.filter((item: any) => item.resource_type === "computer_lab").length,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "server_error", message: error instanceof Error ? error.message : "Erreur serveur." },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const guard = await guardAdmin();
    if (!guard.ok) return guard.response;

    const body = (await request.json().catch(() => ({}))) as { rules?: unknown };
    const rules = normalizeRules(body.rules || body);

    const { data, error } = await guard.srv
      .from("montage_timetable_terrain_rules")
      .upsert(
        {
          institution_id: guard.institutionId,
          rules,
          created_by: guard.userId,
          updated_by: guard.userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "institution_id" },
      )
      .select("id,rules,updated_at")
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { ok: false, error: "terrain_rules_save_failed", message: error.message },
        { status: 400 },
      );
    }

    return NextResponse.json({
      ok: true,
      rules: normalizeRules(data?.rules || rules),
      updated_at: data?.updated_at || null,
      message: "Règles terrain HoraClasse sauvegardées.",
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "server_error", message: error instanceof Error ? error.message : "Erreur serveur." },
      { status: 500 },
    );
  }
}

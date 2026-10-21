import { isTrustedAppOrigin } from "@/lib/request-origin";
// src/app/api/super/institutions/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { requireSuperAdminAccess } from "@/lib/super-admin-access";
import { mergeGeneralSchoolSettings } from "@/lib/school-settings-write";
import { validateNewSchoolCycles } from "@/lib/school-creation";
import { SCHOOL_CYCLES_SETTINGS_KEY } from "@/lib/school-cycles";

function addMonthsISO(dateISO: string, months: number) {
  const d = new Date(dateISO);
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() !== day) d.setDate(0);
  return d.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  // �x� v�rifie super_admin
  const s = await getSupabaseServerClient();
  const { data: { user } } = await s.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data: roles } = await s.from("user_roles").select("role").eq("profile_id", user.id);
  if (!(roles ?? []).some(r => r.role === "super_admin")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const rawLimit = Number(url.searchParams.get("limit") ?? 50);
  const rawOffset = Number(url.searchParams.get("offset") ?? 0);
  const limit = Number.isFinite(rawLimit) ? Math.min(200, Math.max(1, Math.floor(rawLimit))) : 50;
  const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.floor(rawOffset)) : 0;
  const q = (url.searchParams.get("q") ?? "").trim();

  const supabase = getSupabaseServiceClient();
  let query = supabase
    .from("institutions")
    .select(url.searchParams.get("fields") === "id,name,code_unique"
      ? "id,name,code_unique" : "id,name,code_unique,subscription_expires_at,settings_json", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (q) {
    query = query.or(`name.ilike.%${q}%,code_unique.ilike.%${q}%`);
  }

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ items: data ?? [], total: count ?? 0 });
}

export async function POST(req: NextRequest) {
  const access = await requireSuperAdminAccess();
  if ("error" in access) return access.error;
  if (!isTrustedAppOrigin(req)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }
  const supabase = access.srv;
  const payload = await req.json().catch(() => null);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const { name, code_unique, subscription_expires_at, settings_json, duration_months, start_date, school_cycles } = payload;

  if (typeof name !== "string" || !name.trim() || name.trim().length > 180 ||
    typeof code_unique !== "string" || !code_unique.trim() || code_unique.trim().length > 80)
    return NextResponse.json({ error: "name et code_unique requis" }, { status: 400 });
  const initialSettings = mergeGeneralSchoolSettings({}, settings_json ?? {});
  if (!initialSettings) return NextResponse.json({ error: "use_dedicated_settings_editor" }, { status: 400 });
  const cycles = school_cycles === undefined ? undefined : validateNewSchoolCycles(school_cycles);
  if (school_cycles !== undefined && !cycles) return NextResponse.json({ error: "invalid_school_cycle_configuration" }, { status: 400 });
  if (cycles?.enabled) initialSettings[SCHOOL_CYCLES_SETTINGS_KEY] = cycles;

  const startISO = (start_date || new Date().toISOString().slice(0, 10)) as string;
  const months = Number(duration_months ?? 12);
  if (!Number.isInteger(months) || months < 1 || months > 120) {
    return NextResponse.json({ error: "invalid_subscription_duration" }, { status: 400 });
  }
  if (typeof startISO !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(startISO) ||
    !Number.isFinite(new Date(startISO).getTime())) return NextResponse.json({ error: "invalid_start_date" }, { status: 400 });
  const expires = subscription_expires_at && String(subscription_expires_at).length > 0
    ? subscription_expires_at
    : addMonthsISO(startISO, months > 0 ? months : 12);

  const { data, error } = await supabase
    .from("institutions")
    .insert({
      name: name.trim(),
      code_unique: code_unique.trim(),
      subscription_expires_at: expires,
      settings_json: initialSettings,
    })
    .select("id,name,code_unique,subscription_expires_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ item: data });
}



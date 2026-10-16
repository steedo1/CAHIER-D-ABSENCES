import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { requireInstitutionRole } from "@/lib/auth/server-context";
import {
  groupScopedClassesByCycle,
  parseSchoolCyclesSettings,
} from "@/lib/school-cycles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_ROLES = [
  "admin",
  "super_admin",
  "founder",
] as const;

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET() {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();
  const access = await requireInstitutionRole(supa, srv, ALLOWED_ROLES);
  if ("error" in access) {
    return reply({ error: access.error }, access.error === "unauthorized" ? 401 : 403);
  }

  // Server-authorized institution only, never an institution_id from the URL.
  const institutionId = access.instId;
  const { data: institution, error: instErr } = await srv
    .from("institutions")
    .select("id,name,settings_json")
    .eq("id", institutionId)
    .maybeSingle();
  if (instErr || !institution) return reply({ error: "school_load_failed" }, 503);

  const configuration = parseSchoolCyclesSettings(institution.settings_json);
  if (!configuration.enabled) {
    // Keep legacy institutions entirely out of this new navigation.
    return reply({ ok: true, enabled: false });
  }

  const { data: activeYear, error: yearErr } = await srv
    .from("academic_years")
    .select("code")
    .eq("institution_id", institutionId)
    .eq("is_current", true)
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (yearErr) return reply({ error: "academic_year_load_failed" }, 503);

  // Do not silently pick a different year in the new cycle dashboard.
  const year = String(activeYear?.code || "");
  const classes: Array<{
    id: string; institution_id: string; academic_year: string;
    label: string; level: string | null;
  }> = [];

  if (year) {
    // Bounded pagination instead of pulling enrollment/grade tables on page load.
    for (let offset = 0; offset < 10000; offset += 500) {
      const { data: page, error } = await srv
        .from("classes")
        .select("id,institution_id,academic_year,label,level")
        .eq("institution_id", institutionId)
        .eq("academic_year", year)
        .order("id")
        .range(offset, offset + 499);
      if (error) return reply({ error: "classes_load_failed" }, 503);
      classes.push(...(page || []));
      if (!page || page.length < 500) break;
      if (offset === 9500) return reply({ error: "too_many_classes" }, 503);
    }
  }

  const grouped = groupScopedClassesByCycle(classes, institutionId, year, configuration);
  return reply({
    ok: true,
    enabled: true,
    institution: { name: institution.name },
    academicYear: year || null,
    configuration: {
      enabledCycles: configuration.enabledCycles,
      teachingTracksByCycle: configuration.teachingTracksByCycle,
      defaultView: configuration.defaultView,
    },
    totalClasses: classes.length,
    cycles: Object.fromEntries(configuration.enabledCycles.map((cycle) => [
      cycle,
      {
        classes: grouped[cycle].map((row) => ({
          id: row.id,
          label: (row as typeof classes[number]).label,
          level: row.level,
        })),
        count: grouped[cycle].length,
      },
    ])),
  });
}

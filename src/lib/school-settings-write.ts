import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export function asSettingsObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function schoolSettingsRevision(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

/** Generic settings editors cannot provision cycles or edit bulletin policies. */
export function mergeGeneralSchoolSettings(stored: unknown, incoming: unknown) {
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) return null;
  const current = asSettingsObject(stored);
  const update = asSettingsObject(incoming);
  const reserved = ["primary_evaluation_events_v1", "school_cycles_v1", "franco_arabic_reports_v1", "school_directors_v1", "school_student_programs_v1", "school_class_subjects_v1", "school_program_periods_v1", "school_teaching_signatories_v1", "preschool_booklets_v1"];
  for (const key of reserved) {
    if (Object.hasOwn(update, key) && canonical(update[key]) !== canonical(current[key])) return null;
  }
  return { ...current, ...update };
}

/** Compare-and-swap: a concurrent settings write must be reloaded, not lost. */
export async function writeSchoolSettings(
  service: SupabaseClient,
  institutionId: string,
  previous: unknown,
  next: Record<string, unknown>,
  /** Large settings require a compact per-key CAS to stay within HTTP URL limits. */
  compareKey?: "primary_evaluation_events_v1",
) {
  let query = service.from("institutions").update({ settings_json: next }).eq("id", institutionId);
  if (compareKey) {
    // Revision of the entire document is checked by the caller immediately before
    // this update; comparing the small edited JSON key avoids a >20 KB URL on EPC.
    // Preserve existing changes to all unrelated keys from the just-read snapshot.
    const previousValue = asSettingsObject(previous)[compareKey];
    query = previousValue == null
      ? query.is(`settings_json->${compareKey}`, null)
      : query.eq(`settings_json->${compareKey}`, JSON.stringify(previousValue));
  } else {
    query = previous == null
      ? query.is("settings_json", null)
      : query.eq("settings_json", JSON.stringify(previous));
  }
  const { data, error } = await query.select("id").maybeSingle();
  if (error) return { error: "save_failed", status: 503 } as const;
  if (!data) return { error: "settings_changed_reload_required", status: 409 } as const;
  return { revision: schoolSettingsRevision(next) } as const;
}

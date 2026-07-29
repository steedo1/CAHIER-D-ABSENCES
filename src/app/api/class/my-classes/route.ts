// src/app/api/class/my-classes/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { resolveAttendanceEducationContext } from "@/lib/education-attendance";
import { createRelayAttendanceAccessToken } from "@/lib/attendance-presence-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ─────────────────────────────────────────
   Helpers
────────────────────────────────────────── */
function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set((arr || []).filter(Boolean))) as T[];
}

type PhoneVariants = {
  variants: string[];
  likePatterns: string[];
  debug: { raw: string; digits: string; local10: string; localNo0: string };
};

/** Toujours retourner un objet typé (jamais un tableau nu) */
function buildPhoneVariants(raw: string): PhoneVariants {
  const t = String(raw || "").trim();
  const digits = t.replace(/\D/g, "");

  // Valeurs par défaut “vides” mais typées
  let local10 = "";
  let localNo0 = "";

  if (digits) {
    // Local 10 chiffres (CI)
    local10 = digits.slice(-10);
    localNo0 = local10.replace(/^0/, "");
  }

  const cc = "225";

  const variants = uniq<string>([
    t,
    t.replace(/\s+/g, ""),

    digits,

    `+${digits}`,
    `+${cc}${local10}`,
    `+${cc}${localNo0}`,

    `00${cc}${local10}`,
    `00${cc}${localNo0}`,

    `${cc}${local10}`,
    `${cc}${localNo0}`,

    local10,
    localNo0 ? `0${localNo0}` : "",
  ]);

  const likePatterns = uniq<string>([
    local10 ? `%${local10}%` : "",
    local10 ? `%${cc}${local10}%` : "",
    local10 ? `%+${cc}${local10}%` : "",
    local10 ? `%00${cc}${local10}%` : "",
    localNo0 ? `%${cc}${localNo0}%` : "",
    localNo0 ? `%+${cc}${localNo0}%` : "",
    localNo0 ? `%00${cc}${localNo0}%` : "",
  ]);

  return { variants, likePatterns, debug: { raw: t, digits, local10, localNo0 } };
}

/* ─────────────────────────────────────────
   Handler
────────────────────────────────────────── */
export async function GET(req: NextRequest) {
  const supa = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const srv = getSupabaseServiceClient();

  // 1) Téléphone depuis l’auth
  let phone = String(user.phone || "").trim();

  // 2) Fallback robuste: auth.users (schéma auth)
  if (!phone) {
    const { data: au, error: auErr } = await srv
      .schema("auth")
      .from("users")
      .select("phone")
      .eq("id", user.id)
      .maybeSingle();
    if (auErr) return NextResponse.json({ error: auErr.message }, { status: 400 });
    phone = String(au?.phone || "").trim();
  }

  if (!phone) return NextResponse.json({ items: [], hint: "no_phone_on_auth" });

  const { variants, likePatterns, debug } = buildPhoneVariants(phone);

  // 3) Match exact sur un set de variantes
  let items: any[] = [];
  {
    const { data, error } = await srv
      .from("classes")
      .select("id,label,level,institution_id,class_phone_e164,education_type,formation_code,formation_level_code")
      .in("class_phone_e164", variants.length ? variants : ["__no_match__"]); // évite .in([])

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    items = data || [];
  }

  // 4) Fallback flou si rien trouvé (espaces/traits dans la colonne)
  if (items.length === 0 && likePatterns.length) {
    const orExpr = likePatterns.map((p: string) => `class_phone_e164.ilike.${p}`).join(",");
    if (orExpr) {
      const { data, error } = await srv
        .from("classes")
        .select("id,label,level,institution_id,class_phone_e164,education_type,formation_code,formation_level_code")
        .or(orExpr);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      items = data || [];
    }
  }

  /* 5) Enrichir avec le nom d’établissement (sans casser l’ancien format) */
  let enriched = items;
  try {
    const instIds = uniq<string>(
      (items || []).map((c: any) => c?.institution_id).filter(Boolean) as string[]
    );

    if (instIds.length > 0) {
      const [institutionsResult, policiesResult] = await Promise.all([
        srv
          .from("institutions")
          .select("id,name,short_name,settings_json")
          .in("id", instIds),
        srv
          .from("institution_attendance_policies")
          .select("institution_id,enabled,allow_local_relay,relay_local_url,relay_presence_secret")
          .in("institution_id", instIds),
      ]);
      const insts = institutionsResult.data || [];
      const instErr = institutionsResult.error;
      const policyMissing = (policiesResult.error as any)?.code === "42P01";

      if (!instErr && insts) {
        const instById: Record<
          string,
          { id: string; name?: string | null; short_name?: string | null }
        > = {};
        for (const it of insts) {
          instById[it.id] = it;
        }
        const policyByInstitution = new Map(
          (policyMissing ? [] : policiesResult.data || []).map((row: any) => [
            String(row.institution_id || ""),
            row,
          ]),
        );

        enriched = (items || []).map((c: any) => {
          const inst = instById[c.institution_id] || {};
          const policy: any = policyByInstitution.get(String(c.institution_id || "")) || {};
          const institution_name =
            (inst as any).name || (inst as any).short_name || null;
          const relayEnabled =
            policy.enabled === true &&
            policy.allow_local_relay !== false &&
            Boolean(String(policy.relay_local_url || "").trim()) &&
            String(policy.relay_presence_secret || "").length >= 32;
          const relayAccessToken = relayEnabled
            ? createRelayAttendanceAccessToken({
                secret: String(policy.relay_presence_secret || ""),
                institutionId: String(c.institution_id || ""),
                actorProfileId: user.id,
                actorKind: "class_device",
                classId: String(c.id || ""),
              })
            : null;

          const education = resolveAttendanceEducationContext({
            educationType: c.education_type,
            formationCode: c.formation_code,
            formationLevelCode: c.formation_level_code,
            classLevel: c.level,
            settingsJson: (inst as any).settings_json,
          });

          return {
            ...c,
            institution_name,
            education_type: education.education_type,
            education_label: education.education_label,
            education_short_label: education.education_short_label,
            formation_code: education.formation_code,
            formation_label: education.formation_label,
            formation_level_code: education.formation_level_code,
            formation_level_label: education.formation_level_label,
            education_context_key: education.context_key,
            education_context_label: education.context_label,
            actor_profile_id: user.id,
            attendance_presence: {
              enabled: relayEnabled,
              allow_local_relay: policy.allow_local_relay !== false,
              relay_local_url: relayEnabled ? String(policy.relay_local_url) : null,
              relay_access_token: relayAccessToken,
            },
          };
        });
      }
    }
  } catch {
    // En cas de souci, on garde les classes et on fournit au moins le type brut.
    enriched = (items || []).map((c: any) => {
      const education = resolveAttendanceEducationContext({
        educationType: c.education_type,
        formationCode: c.formation_code,
        formationLevelCode: c.formation_level_code,
        classLevel: c.level,
      });
      return {
        ...c,
        education_type: education.education_type,
        education_label: education.education_label,
        education_short_label: education.education_short_label,
        formation_code: education.formation_code,
        formation_label: education.formation_label,
        formation_level_code: education.formation_level_code,
        formation_level_label: education.formation_level_label,
        education_context_key: education.context_key,
        education_context_label: education.context_label,
      };
    });
  }

  // Debug optionnel
  const wantDebug = (new URL(req.url).searchParams.get("debug") || "") === "1";
  return NextResponse.json(
    wantDebug
      ? { items: enriched, debug: { phone, ...debug, variants, likePatterns } }
      : { items: enriched }
  );
}

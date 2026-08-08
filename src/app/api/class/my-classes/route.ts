// src/app/api/class/my-classes/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import {
  ClassDeviceAccessError,
  enrichClassDeviceAccess,
  type ClassDeviceMetadataReader,
} from "@/lib/class-device-access-server";
import { buildClassDeviceCloudSchedule } from "@/lib/class-device-offline-cloud-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ─────────────────────────────────────────
   Helpers
────────────────────────────────────────── */
function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set((arr || []).filter(Boolean))) as T[];
}

function noStoreJson(body: unknown, init?: { status?: number }) {
  const response = NextResponse.json(body, init);
  response.headers.set(
    "Cache-Control",
    "private, no-store, no-cache, max-age=0, must-revalidate",
  );
  response.headers.set("Pragma", "no-cache");
  return response;
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

  /* 5) L'accès relais signé est obligatoire et indépendant des métadonnées
        d'affichage facultatives de l'établissement. */
  let enriched = items;
  let enrichmentDiagnostics: string[] = [];
  try {
    if (items.length > 0) {
      const access = await enrichClassDeviceAccess({
        items,
        actorProfileId: user.id,
        service: srv as unknown as ClassDeviceMetadataReader,
      });
      enriched = access.items;
      enrichmentDiagnostics = access.diagnostics;
    }
  } catch (error) {
    if (error instanceof ClassDeviceAccessError) {
      return NextResponse.json(
        { error: error.code, diagnostic: error.code },
        { status: error.status },
      );
    }
    return NextResponse.json(
      {
        error: "class_relay_access_enrichment_failed",
        diagnostic: "class_relay_access_enrichment_failed",
      },
      { status: 500 },
    );
  }

  const wantsOfflineContractV5 =
    String(new URL(req.url).searchParams.get("offline_contract") || "") === "v5";
  let offlineSchedule: unknown = null;
  let offlineScheduleError: string | null = null;
  if (wantsOfflineContractV5 && enriched.length === 1) {
    const authorized = enriched[0] as any;
    try {
      offlineSchedule = await buildClassDeviceCloudSchedule(srv, {
        institutionId: String(authorized?.institution_id || "").trim(),
        classId: String(authorized?.id || "").trim(),
        actorProfileId: user.id,
        classLabel: String(authorized?.label || "Classe"),
        classLevel: String(authorized?.level || ""),
      });
    } catch (error) {
      offlineScheduleError =
        error instanceof Error ? error.message : "class_offline_schedule_failed";
    }
  }

  // Debug optionnel
  const wantDebug = (new URL(req.url).searchParams.get("debug") || "") === "1";
  const responsePayload = {
    items: enriched,
    diagnostics: enrichmentDiagnostics,
    ...(wantsOfflineContractV5
      ? {
          offline_schedule: offlineSchedule,
          offline_schedule_error: offlineScheduleError,
        }
      : {}),
  };
  return noStoreJson(
    wantDebug
      ? {
          ...responsePayload,
          debug: { phone, ...debug, variants, likePatterns },
        }
      : responsePayload
  );
}

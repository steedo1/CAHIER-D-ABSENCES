// src/app/api/class/my-classes/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import {
  ClassDeviceAccessError,
  enrichClassDeviceAccess,
  type ClassDeviceMetadataReader,
} from "@/lib/class-device-access-server";
import { resolveClassDeviceClassIds } from "@/lib/class-device-identity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ─────────────────────────────────────────
   Helpers
────────────────────────────────────────── */
function noStoreJson(body: unknown, init?: { status?: number }) {
  const response = NextResponse.json(body, init);
  response.headers.set(
    "Cache-Control",
    "private, no-store, no-cache, max-age=0, must-revalidate",
  );
  response.headers.set("Pragma", "no-cache");
  return response;
}

/* ─────────────────────────────────────────
   Handler
────────────────────────────────────────── */
export async function GET(_req: NextRequest) {
  const supa = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const srv = getSupabaseServiceClient();

  const classIds = await resolveClassDeviceClassIds({
    service: srv,
    userId: user.id,
    userPhone: user.phone,
  });
  if (!classIds.length) return NextResponse.json({ items: [] });

  const { data: classRows, error: classError } = await srv
    .from("classes")
    .select("id,label,level,institution_id,class_phone_e164,education_type,formation_code,formation_level_code")
    .in("id", classIds);
  if (classError) {
    return NextResponse.json({ error: classError.message }, { status: 400 });
  }
  const items: any[] = classRows || [];

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

  return noStoreJson(
    { items: enriched, diagnostics: enrichmentDiagnostics },
  );
}

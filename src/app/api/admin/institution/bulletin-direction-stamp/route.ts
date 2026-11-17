import type { NextRequest } from "next/server";
import { CARD_SLOTS, defaultCardConfiguration, type CardConfiguration, type CardSlot } from "@/lib/school-cards";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { requireInstitutionRole } from "@/lib/auth/server-context";
import { cardJson, requireCardOrigin, safeCardAsset } from "@/lib/server/school-cards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function directionContext(write = false) {
  const userClient = await getSupabaseServerClient();
  const service = getSupabaseServiceClient();
  const access = await requireInstitutionRole(userClient, service,
    write ? ["admin", "super_admin"] : ["admin", "super_admin", "file_correspondent"]);
  if ("error" in access) return {
    error: cardJson({ error: access.error }, access.error === "unauthorized" ? 401 : 403),
  } as const;
  const stored = await service.from("school_card_settings")
    .select("configuration,revision").eq("institution_id", access.instId).maybeSingle();
  if (stored.error) return { error: cardJson({ error: "configuration_indisponible" }, 503) } as const;
  return {
    service, instId: access.instId, user: access.user,
    configuration: (stored.data?.configuration || defaultCardConfiguration()) as CardConfiguration,
    revision: Number(stored.data?.revision || 0),
  } as const;
}

/**
 * Direction stamp for report cards. Separate from teachers' signatures and
 * school-card automatic signatures. Never expose private storage paths.
 */
export async function GET() {
  try {
    const ctx = await directionContext(false);
    if ("error" in ctx) return ctx.error;
    const configured = ctx.configuration.stamps || {};
    const available = Object.fromEntries(CARD_SLOTS.map(slot => [
      slot, Boolean(configured[slot] && safeCardAsset(ctx.instId, configured[slot]!)),
    ])) as Record<CardSlot, boolean>;
    const enabled = ctx.configuration.documentPolicies?.bulletins === true;
    const stamps: Partial<Record<CardSlot, string>> = {};
    if (enabled) {
      for (const slot of CARD_SLOTS) {
        const asset = configured[slot];
        if (!asset || !safeCardAsset(ctx.instId, asset)) continue;
        const image = await ctx.service.storage.from("signatures").download(asset.processed);
        if (image.error || !image.data) return cardJson({ error: "cachet_direction_indisponible" }, 503);
        const bytes = Buffer.from(await image.data.arrayBuffer());
        // The card upload route stores processed PNGs only.
        if (bytes.byteLength > 5 * 1024 * 1024 ||
          bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
          return cardJson({ error: "image_cachet_invalide" }, 503);
        }
        stamps[slot] = `data:image/png;base64,${bytes.toString("base64")}`;
      }
    }
    return cardJson({ ok: true, enabled, available, stamps });
  } catch {
    return cardJson({ error: "chargement_cachet_impossible" }, 503);
  }
}

export async function POST(req: NextRequest) {
  if (!requireCardOrigin(req)) return cardJson({ error: "origine_invalide" }, 403);
  try {
    const ctx = await directionContext(true);
    if ("error" in ctx) return ctx.error;
    const body = await req.json().catch(() => null) as { enabled?: unknown; revision?: unknown } | null;
    if (typeof body?.enabled !== "boolean") return cardJson({ error: "activation_invalide" }, 400);
    if (body.enabled && !CARD_SLOTS.some(slot => {
      const asset = ctx.configuration.stamps?.[slot];
      return asset && safeCardAsset(ctx.instId, asset);
    })) return cardJson({ error: "enregistrer_un_cachet_avant_activation" }, 409);
    const configuration: CardConfiguration = {
      ...ctx.configuration,
      documentPolicies: {
        cards: ctx.configuration.automaticSignature,
        bulletins: body.enabled,
        attestations: false,
        other: false,
      },
    };
    const record = {
      institution_id: ctx.instId, configuration, revision: ctx.revision + 1,
      updated_by: ctx.user.id, updated_at: new Date().toISOString(),
    };
    const result = ctx.revision === 0
      ? await ctx.service.from("school_card_settings").insert(record).select("revision").single()
      : await ctx.service.from("school_card_settings")
          .update(record).eq("institution_id", ctx.instId)
          .eq("revision", ctx.revision).select("revision").maybeSingle();
    if (result.error || !result.data) return cardJson({ error: "configuration_modifiee_recharger" }, 409);
    return cardJson({ ok: true, enabled: body.enabled, revision: result.data.revision });
  } catch {
    return cardJson({ error: "activation_cachet_impossible" }, 503);
  }
}

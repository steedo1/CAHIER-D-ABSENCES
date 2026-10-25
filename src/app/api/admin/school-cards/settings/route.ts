import type { NextRequest } from "next/server";
import type { CardConfiguration } from "@/lib/school-cards";
import { cardJson, cardScope, requireCardOrigin, publicCardConfig } from "@/lib/server/school-cards";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function PUT(req: NextRequest) {
  if (!requireCardOrigin(req)) return cardJson({ error: "origine_invalide" }, 403);
  try {
    const ctx = await cardScope(true); if ("error" in ctx) return ctx.error;
    const body = await req.json();
    if (body.revision !== ctx.revision) return cardJson({ error: "configuration_modifiee_recharger" }, 409);
    if (typeof body.enabled !== "boolean" || typeof body.automaticSignature !== "boolean") return cardJson({ error: "options_invalides" }, 400);
    const configuration: CardConfiguration = { ...ctx.configuration, enabled: body.enabled, automaticSignature: body.automaticSignature,
      documentPolicies: { cards: body.automaticSignature, bulletins: false, attestations: false, other: false } };
    const record = { institution_id: ctx.instId, configuration, revision: ctx.revision + 1,
      updated_by: ctx.user.id, updated_at: new Date().toISOString() };
    const result = ctx.revision === 0
      ? await ctx.service.from("school_card_settings").insert(record).select("revision").single()
      : await ctx.service.from("school_card_settings").update(record).eq("institution_id", ctx.instId).eq("revision", ctx.revision).select("revision").maybeSingle();
    if (result.error || !result.data) return cardJson({ error: "configuration_modifiee_ou_indisponible" }, 409);
    return cardJson({ configuration: publicCardConfig(configuration), revision: result.data.revision });
  } catch { return cardJson({ error: "enregistrement_impossible" }, 503); }
}

import type { NextRequest } from "next/server";
import { CARD_UUID } from "@/lib/school-card-token";
import { cardJson, cardScope, requireCardOrigin, loadCardEnrollments } from "@/lib/server/school-cards";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  if (!requireCardOrigin(req)) return cardJson({ error: "origine_invalide" }, 403);
  try {
    const ctx = await cardScope(true); if ("error" in ctx) return ctx.error;
    const body = await req.json();
    if (!Array.isArray(body.enrollmentIds) || !body.enrollmentIds.length || body.enrollmentIds.length > 100 || typeof body.revoked !== "boolean" || !body.enrollmentIds.every((id: unknown) => typeof id === "string" && CARD_UUID.test(id))) return cardJson({ error: "selection_invalide" }, 400);
    const ids = [...new Set(body.enrollmentIds)] as string[];
    const { items } = await loadCardEnrollments(ctx, String(body.year), { enrollmentIds: ids });
    if (items.length !== ids.length) return cardJson({ error: "selection_interdite" }, 403);
    const result = await ctx.service.from("school_card_revocations").upsert(ids.map(id => ({
      institution_id: ctx.instId, enrollment_id: id, revoked: body.revoked, updated_by: ctx.user.id, updated_at: new Date().toISOString(),
    })), { onConflict: "institution_id,enrollment_id" });
    if (result.error) return cardJson({ error: "invalidation_impossible" }, 503);
    return cardJson({ ok: true });
  } catch { return cardJson({ error: "invalidation_impossible" }, 503); }
}

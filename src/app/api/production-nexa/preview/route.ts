import type { NextRequest } from "next/server";
import { cardJson, loadCardEnrollments, requireCardOrigin } from "@/lib/server/school-cards";
import { isUuid, isYear, productionAccess, productionFailure, productionJson, productionSchool } from "@/lib/server/production-nexa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!requireCardOrigin(req)) return cardJson({ error: "origine_invalide" }, 403);
  try {
    const access = await productionAccess(); if ("error" in access) return access.error;
    const body = await productionJson(req);
    const ctx = await productionSchool(access, body.school, "cards.read"); if ("error" in ctx) return ctx.error;
    if (!isYear(body.year) || !isUuid(body.studentId)) return cardJson({ error: "selection_invalide" }, 400);
    const result = await loadCardEnrollments(ctx, body.year, { studentIds: [body.studentId] });
    if (!result.items[0] || result.items[0].revoked) return cardJson({ error: "carte_hors_perimetre_ou_invalidee" }, 403);
    const { protectedCardPreview } = await import("@/lib/server/school-card-preview");
    return cardJson(await protectedCardPreview(ctx, result.items[0]));
  } catch (error) { return productionFailure(error); }
}

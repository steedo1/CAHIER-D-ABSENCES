import type { NextRequest } from "next/server";
import { cardJson, cardScope, requireCardOrigin, loadCardEnrollments, readCardYears, publicCardConfig, isCardYearValid } from "@/lib/server/school-cards";
import { isUuid, productionFailure, productionJson } from "@/lib/server/production-nexa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const ctx = await cardScope(); if ("error" in ctx) return ctx.error;
    const years = await readCardYears(ctx.service, ctx.instId);
    const year = req.nextUrl.searchParams.get("year") || years.find(y => y.is_current)?.code || years[0]?.code || "";
    const offset = Number(req.nextUrl.searchParams.get("offset") || 0);
    if (!years.some(y => y.code === year) || !Number.isInteger(offset) || offset < 0 || offset > 50_000) return cardJson({ error: "annee_ou_page_invalide" }, 400);
    const roster = await loadCardEnrollments(ctx, year, { offset, includePhotos: false });
    const ids = roster.items.map(row => row.studentId);
    const preparedIds: string[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      const result = await ctx.service.from("nexa_card_preparations").select("student_id")
        .eq("institution_id", ctx.instId).eq("academic_year", year).in("student_id", ids.slice(i, i + 100));
      if (result.error) throw Error("preparations_indisponibles");
      preparedIds.push(...result.data.map(row => row.student_id));
    }
    const { settings_json: _, subscription_expires_at: __, ...school } = ctx.school;
    return cardJson({ school, years, year, ...roster, configuration: publicCardConfig(ctx.configuration),
      revision: ctx.revision, canConfigure: ctx.canConfigure, preparedIds });
  } catch (error) { return productionFailure(error); }
}

export async function POST(req: NextRequest) {
  if (!requireCardOrigin(req)) return cardJson({ error: "origine_invalide" }, 403);
  try {
    const ctx = await cardScope(); if ("error" in ctx) return ctx.error;
    if (!ctx.configuration.enabled) return cardJson({ error: "cartes_suspendues" }, 403);
    const body = await productionJson(req, 24_000);
    if (body.action !== "preview") return cardJson({ error: "production_reservee_a_nexa" }, 403);
    if (!isUuid(body.studentId) || typeof body.year !== "string") return cardJson({ error: "selection_invalide" }, 400);
    const years = await readCardYears(ctx.service, ctx.instId);
    if (!isCardYearValid(years.find(year => year.code === body.year))) return cardJson({ error: "annee_non_active_ou_expiree" }, 409);
    const { items } = await loadCardEnrollments(ctx, body.year, { studentIds: [body.studentId] });
    if (!items[0] || items[0].revoked) return cardJson({ error: "carte_hors_perimetre_ou_invalidee" }, 403);
    const { protectedCardPreview } = await import("@/lib/server/school-card-preview");
    return cardJson(await protectedCardPreview(ctx, items[0]));
  } catch (error) { return productionFailure(error); }
}

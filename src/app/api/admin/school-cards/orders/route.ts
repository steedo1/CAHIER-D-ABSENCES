import type { NextRequest } from "next/server";
import { cardJson, cardScope, isCardYearValid, readCardYears, requireCardOrigin } from "@/lib/server/school-cards";
import { isYear, ORDER_FIELDS, productionFailure, productionJson, selectedCards, studentSelection } from "@/lib/server/production-nexa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const ctx = await cardScope(); if ("error" in ctx) return ctx.error;
    const year = req.nextUrl.searchParams.get("year");
    const offset = Number(req.nextUrl.searchParams.get("offset") || 0);
    if (!isYear(year) || !Number.isInteger(offset) || offset < 0) return cardJson({ error: "annee_ou_page_invalide" }, 400);
    let query = ctx.service.from("nexa_card_orders").select(ORDER_FIELDS).eq("institution_id", ctx.instId).eq("academic_year", year);
    if (ctx.educatorAssignments) query = query.eq("submitted_by", ctx.user.id);
    const result = await query.order("created_at", { ascending: false }).order("id").range(offset, offset + 49);
    if (result.error) throw Error("commandes_indisponibles");
    return cardJson({ orders: result.data, nextOffset: result.data.length === 50 ? offset + 50 : null });
  } catch (error) { return productionFailure(error); }
}

export async function POST(req: NextRequest) {
  if (!requireCardOrigin(req)) return cardJson({ error: "origine_invalide" }, 403);
  try {
    const ctx = await cardScope(); if ("error" in ctx) return ctx.error;
    if (!ctx.configuration.enabled) return cardJson({ error: "cartes_suspendues" }, 403);
    const body = await productionJson(req, 400_000);
    if (!isYear(body.year) || !["prepare", "order"].includes(String(body.action))) return cardJson({ error: "demande_invalide" }, 400);
    const ids = studentSelection(body.studentIds, 10_000);
    const years = await readCardYears(ctx.service, ctx.instId);
    if (!isCardYearValid(years.find(year => year.code === body.year))) return cardJson({ error: "annee_non_active_ou_expiree" }, 409);
    await selectedCards(ctx, body.year, ids);
    const result = await ctx.service.rpc("nexa_prepare_cards", {
      p_school: ctx.instId, p_year: body.year, p_actor: ctx.user.id, p_students: ids, p_order: body.action === "order",
    });
    if (result.error) throw Error("preparation_ou_commande_indisponible");
    return cardJson({ count: ids.length, orderId: result.data });
  } catch (error) { return productionFailure(error); }
}

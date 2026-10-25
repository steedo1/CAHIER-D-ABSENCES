import type { NextRequest } from "next/server";
import { CARD_UUID } from "@/lib/school-card-token";
import { cardJson, cardScope, requireCardOrigin, loadCardEnrollments, readCardYears, publicCardConfig, cardSignatureImages, prepareSchoolCards, isCardYearValid } from "@/lib/server/school-cards";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const ctx = await cardScope(); if ("error" in ctx) return ctx.error;
    const years = await readCardYears(ctx.service, ctx.instId);
    const year = req.nextUrl.searchParams.get("year") || years.find(y => y.is_current)?.code || "";
    const offset = Number(req.nextUrl.searchParams.get("offset") || 0);
    if (!years.some(y => y.code === year) || !Number.isInteger(offset) || offset < 0 || offset > 50_000) return cardJson({ error: "annee_ou_page_invalide" }, 400);
    const roster = await loadCardEnrollments(ctx, year, { offset });
    const { settings_json: _, subscription_expires_at: __, ...school } = ctx.school;
    return cardJson({ school, years, year, ...roster, configuration: publicCardConfig(ctx.configuration),
      revision: ctx.revision, canConfigure: ctx.canConfigure, signatureImages: offset === 0 ? await cardSignatureImages(ctx) : {} });
  } catch { return cardJson({ error: "chargement_cartes_impossible" }, 503); }
}

/** Explicit preparation only. Bounded grouped reads, NO insert/update and NO
 * bulletin_qr_codes access. Client keeps results for previews and reprints. */
export async function POST(req: NextRequest) {
  if (!requireCardOrigin(req)) return cardJson({ error: "origine_invalide" }, 403);
  if (Number(req.headers.get("content-length") || 0) > 24_000) return cardJson({ error: "lot_trop_grand" }, 413);
  try {
    const ctx = await cardScope(); if ("error" in ctx) return ctx.error;
    if (!ctx.configuration.enabled) return cardJson({ error: "cartes_suspendues" }, 403);
    const body = await req.json();
    if (!Array.isArray(body.enrollmentIds) || body.enrollmentIds.length < 1 || body.enrollmentIds.length > 100 || !body.enrollmentIds.every((id: unknown) => typeof id === "string" && CARD_UUID.test(id)) || typeof body.year !== "string") return cardJson({ error: "selection_invalide" }, 400);
    const years = await readCardYears(ctx.service, ctx.instId);
    if (!isCardYearValid(years.find(y => y.code === body.year))) return cardJson({ error: "annee_non_active_ou_expiree" }, 409);
    const ids = [...new Set(body.enrollmentIds)] as string[];
    const { items } = await loadCardEnrollments(ctx, body.year, { enrollmentIds: ids });
    if (items.length !== ids.length || items.some(row => row.revoked)) return cardJson({ error: "selection_interdite_ou_invalidee" }, 403);
    // URL comes from server deployment config, never a client-provided domain.
    const origin = process.env.SCHOOL_CARD_PUBLIC_ORIGIN || "https://www.mon-cahier.com";
    if (!/^https:\/\/[^/]+$/.test(origin) && !(process.env.NODE_ENV !== "production" && /^http:\/\/localhost:\d+$/.test(origin))) return cardJson({ error: "domaine_verification_invalide" }, 503);
    return cardJson({ items: prepareSchoolCards(ctx, items, origin), signatureImages: await cardSignatureImages(ctx) });
  } catch { return cardJson({ error: "preparation_cartes_impossible" }, 503); }
}

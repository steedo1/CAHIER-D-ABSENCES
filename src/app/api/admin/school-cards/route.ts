import type { NextRequest } from "next/server";
import { schoolCardClasses, type CardSlot, type SchoolCard } from "@/lib/school-cards";
import { CARD_UUID } from "@/lib/school-card-token";
import { cardJson, cardScope, requireCardOrigin, loadCardEnrollments, readCardYears, publicCardConfig, cardSignatureImages, cardStampImages, prepareSchoolCards, isCardYearValid } from "@/lib/server/school-cards";
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
      revision: ctx.revision, canConfigure: ctx.canConfigure, signatureImages: {}, stampImages: {} });
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
    // Content-Length is optional with chunked requests; enforce a real cap
    // before parsing JSON to protect Render's limited server memory.
    const reader = req.body?.getReader();
    if (!reader) return cardJson({ error: "selection_invalide" }, 400);
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > 24_000) {
          await reader.cancel();
          return cardJson({ error: "lot_trop_grand" }, 413);
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const isId = (id: unknown): id is string => typeof id === "string" && CARD_UUID.test(id);
    const isCardRef = (ref: unknown): ref is Pick<SchoolCard, "enrollmentId" | "classId"> => {
      if (!ref || typeof ref !== "object") return false;
      const { enrollmentId, classId } = ref as Record<string, unknown>;
      return isId(enrollmentId) && isId(classId);
    };
    if (!body || typeof body.year !== "string") return cardJson({ error: "selection_invalide" }, 400);
    const selection = body.cards ?? body.enrollmentIds;
    if (!Array.isArray(selection) || selection.length < 1 || selection.length > 100 ||
      (body.cards !== undefined ? !selection.every(isCardRef) : !selection.every(isId))) {
      return cardJson({ error: "selection_invalide" }, 400);
    }
    const cardRefs: Pick<SchoolCard, "enrollmentId" | "classId">[] | null = body.cards === undefined ? null : selection;
    const ids = [...new Set<string>(cardRefs ? cardRefs.map(card => card.enrollmentId) : selection)];
    const years = await readCardYears(ctx.service, ctx.instId);
    if (!isCardYearValid(years.find(y => y.code === body.year))) return cardJson({ error: "annee_non_active_ou_expiree" }, 409);
    const { items } = await loadCardEnrollments(ctx, body.year, { enrollmentIds: ids });
    const byEnrollment = new Map(items.map(item => [item.enrollmentId, item]));
    const unavailableClass = cardRefs?.some(ref => {
      const card = byEnrollment.get(ref.enrollmentId);
      return !card || !schoolCardClasses(card).some(classe => classe.id === ref.classId);
    });
    if (items.length !== ids.length || unavailableClass || items.some(row => row.revoked)) {
      return cardJson({ error: "selection_interdite_ou_invalidee" }, 403);
    }
    // URL comes from server deployment config, never a client-provided domain.
    const origin = process.env.SCHOOL_CARD_PUBLIC_ORIGIN || "https://www.mon-cahier.com";
    if (!/^https:\/\/[^/]+$/.test(origin) && !(process.env.NODE_ENV !== "production" && /^http:\/\/localhost:\d+$/.test(origin))) return cardJson({ error: "domaine_verification_invalide" }, 503);
    const prepared = prepareSchoolCards(ctx, items, origin);
    const slots = new Set<CardSlot>();
    for (const card of prepared) if (card.signatureSlot) slots.add(card.signatureSlot);
    const [signatureImages, stampImages] = await Promise.all([cardSignatureImages(ctx, slots), cardStampImages(ctx, slots)]);
    return cardJson({ items: prepared, signatureImages, stampImages });
  } catch { return cardJson({ error: "preparation_cartes_impossible" }, 503); }
}

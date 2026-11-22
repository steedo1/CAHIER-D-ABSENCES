import type { NextRequest } from "next/server";
import { PDF_BATCH_SIZE, ORDER_TRANSITIONS, type OrderStatus } from "@/lib/production-nexa";
import { activeOrder, ARCHIVE_FIELDS, canProduce, EVENT_FIELDS, isUuid, isYear, issueGenerationTicket,
  ORDER_FIELDS, productionAccess, productionBatchKey, productionStudentsDigest, ProductionError, productionFailure, productionJson, productionSchool,
  selectedCards, studentSelection } from "@/lib/server/production-nexa";
import { cardJson, cardSignatureImages, cardStampImages, isCardYearValid, loadCardEnrollments,
  productionCardVisuals, readCardYears, requireCardOrigin } from "@/lib/server/school-cards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const access = await productionAccess(); if ("error" in access) return access.error;
    if (!canProduce(access, "cards.read")) return cardJson({ error: "lecture_production_non_autorisee" }, 403);
    const params = req.nextUrl.searchParams;
    const inst = params.get("school");
    const offset = Number(params.get("offset") || 0);
    if (!Number.isInteger(offset) || offset < 0 || offset > 50_000) return cardJson({ error: "page_invalide" }, 400);
    if (!inst) {
      let query = access.service.from("institutions").select("id,name,code").order("name").order("id");
      if (access.account && !access.account.all_schools) {
        if (!access.account.institution_ids.length) return cardJson({ schools: [], nextOffset: null });
        query = query.in("id", access.account.institution_ids);
      }
      const result = await query.range(offset, offset + 499);
      if (result.error) throw Error("etablissements_indisponibles");
      return cardJson({ schools: result.data, nextOffset: result.data.length === 500 ? offset + 500 : null });
    }
    const ctx = await productionSchool(access, inst, "cards.read"); if ("error" in ctx) return ctx.error;
    const page = params.get("view") || "cards";
    const requestedYear = params.get("year");
    const years = !requestedYear || page === "years" ? await readCardYears(ctx.service, inst) : [];
    if (page === "years") return cardJson({ years });
    const year = requestedYear || years.find(row => row.is_current)?.code || years[0]?.code;
    if (!isYear(year)) return cardJson({ error: "annee_invalide" }, 400);
    const permissions = { canOrder: canProduce(access, "cards.orders", inst),
      canGenerate: canProduce(access, "cards.generate", inst), canDownload: canProduce(access, "cards.download", inst) };
    if (page === "orders") {
      const { data, error } = await ctx.service.from("nexa_card_orders").select(ORDER_FIELDS)
        .eq("institution_id", inst).eq("academic_year", year).order("created_at", { ascending: false }).order("id").range(offset, offset + 49);
      if (error) throw Error("commandes_indisponibles");
      return cardJson({ orders: data, ...permissions, nextOffset: data.length === 50 ? offset + 50 : null });
    }
    if (page === "archives") {
      const { data, error } = await ctx.service.from("nexa_card_archives").select(ARCHIVE_FIELDS)
        .eq("institution_id", inst).eq("academic_year", year).order("created_at", { ascending: false }).order("id").range(offset, offset + 49);
      if (error) throw Error("archives_indisponibles");
      const actorIds = [...new Set(data.map(row => row.actor_id))];
      const actors = actorIds.length ? await ctx.service.from("nexa_production_accounts").select("user_id,email").in("user_id", actorIds) : null;
      if (actors?.error) throw Error("responsables_indisponibles");
      const emails = new Map(actors?.data?.map(row => [row.user_id, row.email]));
      return cardJson({ archives: data.map(row => ({ ...row, actor_name: emails.get(row.actor_id) ?? "Super-administration" })), ...permissions, nextOffset: data.length === 50 ? offset + 50 : null });
    }
    if (page === "history") {
      const subject = params.get("id");
      if (!isUuid(subject)) return cardJson({ error: "archive_invalide" }, 400);
      const { data, error } = await ctx.service.from("nexa_production_audit").select(EVENT_FIELDS)
        .eq("institution_id", inst).eq("academic_year", year).eq("subject_id", subject)
        .order("created_at", { ascending: false }).order("id").range(offset, offset + 49);
      if (error) throw Error("historique_indisponible");
      return cardJson({ history: data, nextOffset: data.length === 50 ? offset + 50 : null });
    }
    if (page !== "cards") return cardJson({ error: "vue_invalide" }, 400);
    const [roster, prepared] = await Promise.all([
      loadCardEnrollments(ctx, year, { offset, includePhotos: false }),
      ctx.service.from("nexa_card_preparations").select("student_id").eq("institution_id", inst).eq("academic_year", year)
        .order("student_id").range(offset, offset + 499),
    ]);
    if (prepared.error) throw Error("preparations_indisponibles");
    return cardJson({ ...roster, year, ...permissions,
      preparedIds: prepared.data.map(row => row.student_id),
      nextOffset: roster.nextOffset ?? (prepared.data.length === 500 ? offset + 500 : null) });
  } catch (error) { return productionFailure(error); }
}

export async function POST(req: NextRequest) {
  if (!requireCardOrigin(req)) return cardJson({ error: "origine_invalide" }, 403);
  try {
    const access = await productionAccess(); if ("error" in access) return access.error;
    const body = await productionJson(req, 400_000);
    if (!isYear(body.year) || !["orderStatus", "generation", "prepare"].includes(String(body.action))) {
      return cardJson({ error: "demande_invalide" }, 400);
    }
    const permission = body.action === "orderStatus" ? "cards.orders" : "cards.generate";
    const ctx = await productionSchool(access, body.school, permission); if ("error" in ctx) return ctx.error;
    if (body.action === "prepare") {
      if (!ctx.configuration.enabled) return cardJson({ error: "cartes_suspendues" }, 403);
      const ids = studentSelection(body.studentIds, 10_000);
      const years = await readCardYears(ctx.service, ctx.instId);
      if (!isCardYearValid(years.find(row => row.code === body.year))) {
        return cardJson({ error: "annee_non_active_ou_expiree" }, 409);
      }
      await selectedCards(ctx, body.year, ids);
      const result = await ctx.service.rpc("nexa_prepare_cards", {
        p_school: ctx.instId, p_year: body.year, p_actor: access.userId, p_students: ids, p_order: false,
      });
      if (result.error) throw Error("preparation_cartes_indisponible");
      return cardJson({ count: ids.length });
    }
    if (body.action === "orderStatus") {
      if (!isUuid(body.orderId) || !Number.isInteger(body.revision) || typeof body.status !== "string") {
        return cardJson({ error: "commande_invalide" }, 400);
      }
      const lookup = await ctx.service.from("nexa_card_orders").select(ORDER_FIELDS).eq("id", body.orderId)
        .eq("institution_id", ctx.instId).eq("academic_year", body.year).maybeSingle();
      if (lookup.error) throw Error("commande_indisponible");
      const order = lookup.data;
      if (!order) return cardJson({ error: "commande_introuvable" }, 404);
      if (order.revision !== body.revision || !ORDER_TRANSITIONS[order.status as OrderStatus]?.includes(body.status as OrderStatus)) {
        return cardJson({ error: "transition_ou_revision_invalide" }, 409);
      }
      const result = await ctx.service.from("nexa_card_orders")
        .update({ status: body.status, actor_id: access.userId, revision: order.revision + 1 })
        .eq("id", order.id).eq("institution_id", ctx.instId).eq("academic_year", body.year)
        .eq("revision", body.revision).select(ORDER_FIELDS).maybeSingle();
      if (result.error?.message.includes("order_production_incomplete")) return cardJson({ error: "il_reste_des_cartes_a_produire_dans_cette_commande" }, 409);
      if (result.error) throw Error("statut_commande_indisponible");
      return result.data ? cardJson({ order: result.data }) : cardJson({ error: "commande_modifiee_recharger" }, 409);
    }
    if (!ctx.configuration.enabled) return cardJson({ error: "cartes_suspendues" }, 403);
    if ((body.orderId != null && !isUuid(body.orderId)) || (body.previousId != null && !isUuid(body.previousId)) ||
      !["pvc", "a4"].includes(String(body.format)) || !["long", "short"].includes(String(body.flip))) {
      return cardJson({ error: "parametres_de_production_invalides" }, 400);
    }
    const ids = studentSelection(body.studentIds, PDF_BATCH_SIZE);
    const flip = body.format === "pvc" ? "long" : body.flip;
    const [years, order, previous, preparation] = await Promise.all([
      readCardYears(ctx.service, ctx.instId),
      body.orderId ? ctx.service.from("nexa_card_orders").select("id,status,student_ids").eq("id", body.orderId)
        .eq("institution_id", ctx.instId).eq("academic_year", body.year).maybeSingle() : null,
      body.previousId ? ctx.service.from("nexa_card_archives").select("id,version,student_ids,order_id,format,flip").eq("id", body.previousId)
        .eq("institution_id", ctx.instId).eq("academic_year", body.year).maybeSingle() : null,
      ctx.service.from("nexa_card_preparations").select("student_id").eq("institution_id", ctx.instId).eq("academic_year", body.year).in("student_id", ids),
    ]);
    if (order?.error || previous?.error || preparation.error) throw Error("verification_production_indisponible");
    if (body.previousId && (!previous?.data || previous.data.format !== body.format || previous.data.flip !== flip ||
      previous.data.order_id !== (body.orderId ?? null) || JSON.stringify(previous.data.student_ids) !== JSON.stringify(ids))) {
      throw new ProductionError("version_ou_selection_invalide", 409);
    }
    const orderData = order?.data;
    if (body.orderId && (!orderData || (!previous?.data && !activeOrder(orderData.status)) ||
      !ids.every(id => orderData.student_ids.includes(id)))) throw new ProductionError("selection_hors_commande_ou_commande_close", 409);
    if (!isCardYearValid(years.find(row => row.code === body.year))) throw new ProductionError("annee_non_active_ou_expiree", 409);
    if (preparation.data.length !== ids.length) throw new ProductionError("certaines_cartes_ne_sont_pas_preparees", 409);
    const batchKey = productionBatchKey(ctx.instId, body.year, orderData?.id ?? null, body.format, flip, ids);
    const lastArchive = await ctx.service.from("nexa_card_archives").select(ARCHIVE_FIELDS)
      .eq("batch_key", batchKey).order("version", { ascending: false }).limit(1).maybeSingle();
    if (lastArchive.error) throw Error("verification_archive_indisponible");
    if (!body.previousId && lastArchive.data) return cardJson({ archive: lastArchive.data });
    if (body.previousId && lastArchive.data?.id !== body.previousId) throw new ProductionError("version_plus_recente_disponible", 409);
    const selected = await selectedCards(ctx, body.year, ids, true);
    const items = productionCardVisuals(ctx, selected);
    if (body.allowMissing !== true && selected.some(item => item.warnings.length)) {
      throw new ProductionError("confirmer_les_informations_manquantes", 409);
    }
    const slots = new Set(items.flatMap(item => item.signatureSlot ? [item.signatureSlot] : []));
    // Return just the missing slots for a multi-lot export. A settings revision
    // change invalidates all previously received visual data in the browser.
    const reuseVisuals = body.visualRevision === ctx.revision;
    const knownSlots = reuseVisuals && Array.isArray(body.visualSlots) ? body.visualSlots : [];
    const neededSlots = new Set([...slots].filter(slot => !knownSlots.includes(slot)));
    const [signatures, stamps] = await Promise.all([cardSignatureImages(ctx, neededSlots), cardStampImages(ctx, neededSlots)]);
    const students = items.map(item => ({ id: item.studentId, name: item.name, matricule: item.matricule }));
    const ticket = issueGenerationTicket({
      actorId: access.userId, institutionId: ctx.instId, year: body.year, orderId: order?.data?.id ?? null,
      previousId: previous?.data?.id ?? null, batchKey, version: Number(previous?.data?.version ?? 0) + 1,
      format: body.format as "pvc" | "a4", flip: flip as "long" | "short",
      studentIds: ids, studentsDigest: productionStudentsDigest(students),
    });
    const audit = await ctx.service.from("nexa_production_audit").insert({
      actor_id: access.userId, institution_id: ctx.instId, academic_year: body.year, action: "assets_requested",
      subject_id: order?.data?.id ?? ctx.instId, details: { count: ids.length, previousId: body.previousId ?? null },
    });
    if (audit.error) throw Error("journal_production_indisponible");
    const { settings_json: _, subscription_expires_at: __, ...school } = ctx.school;
    return cardJson({ items, ...(!reuseVisuals && { school }), signatures, stamps, ticket, visualRevision: ctx.revision });
  } catch (error) { return productionFailure(error); }
}

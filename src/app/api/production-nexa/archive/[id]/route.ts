import type { NextRequest } from "next/server";
import { PRODUCTION_BUCKET } from "@/lib/production-nexa";
import { canProduce, isUuid, productionAccess, productionFailure } from "@/lib/server/production-nexa";
import { cardJson, requireCardOrigin } from "@/lib/server/school-cards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!requireCardOrigin(req)) return cardJson({ error: "origine_invalide" }, 403);
  try {
    const access = await productionAccess(); if ("error" in access) return access.error;
    const { id } = await context.params;
    const school = req.nextUrl.searchParams.get("school");
    if (!isUuid(id) || !isUuid(school)) return cardJson({ error: "archive_invalide" }, 400);
    if (!canProduce(access, "cards.download", school)) return cardJson({ error: "telechargement_non_autorise" }, 403);
    const record = await access.service.from("nexa_card_archives").select("id,academic_year,version,object_path")
      .eq("id", id).eq("institution_id", school).maybeSingle();
    if (record.error) throw Error("archive_indisponible");
    if (!record.data) return cardJson({ error: "archive_introuvable" }, 404);
    const { academic_year: year, object_path: path, version } = record.data;
    const result = await access.service.storage.from(PRODUCTION_BUCKET).download(path).asStream();
    if (result.error || !result.data) throw Error("pdf_indisponible");
    const audit = await access.service.from("nexa_production_audit").insert({
      actor_id: access.userId, institution_id: school, academic_year: year, action: "downloaded", subject_id: id, details: { version },
    });
    if (audit.error) {
      await result.data.cancel();
      throw Error("journal_production_indisponible");
    }
    return new Response(result.data, { headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Cartes-${year}-v${version}-${id.slice(0, 8)}.pdf"`,
      "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) { return productionFailure(error); }
}

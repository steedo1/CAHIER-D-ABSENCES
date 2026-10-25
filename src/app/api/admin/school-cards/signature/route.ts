import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { CARD_SLOTS, type CardSlot } from "@/lib/school-cards";
import { processSchoolCardSignature } from "@/lib/school-card-image";
import { cardJson, cardScope, requireCardOrigin, safeCardAsset } from "@/lib/server/school-cards";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Original recovery is restricted to configuration administrators.
export async function GET(req: NextRequest) {
  try {
    const ctx = await cardScope(true); if ("error" in ctx) return ctx.error;
    const slot = req.nextUrl.searchParams.get("slot") as CardSlot;
    const asset = ctx.configuration.signatures?.[slot];
    if (!asset || !safeCardAsset(ctx.instId, asset)) return cardJson({ error: "image_absente" }, 404);
    const result = await ctx.service.storage.from("signatures").download(asset.original);
    if (result.error || !result.data) return cardJson({ error: "image_indisponible" }, 503);
    return new Response(await result.data.arrayBuffer(), { headers: { "Content-Type": result.data.type || "application/octet-stream",
      "Content-Disposition": 'attachment; filename="signature-originale"', "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch { return cardJson({ error: "image_indisponible" }, 503); }
}
export async function POST(req: NextRequest) {
  if (!requireCardOrigin(req)) return cardJson({ error: "origine_invalide" }, 403);
  if (Number(req.headers.get("content-length") || 0) > 6 * 1024 * 1024) return cardJson({ error: "image_trop_lourde" }, 413);
  try {
    const ctx = await cardScope(true); if ("error" in ctx) return ctx.error;
    // Bound the actual streamed body: chunked uploads can omit Content-Length.
    // Parsing multipart directly would otherwise buffer arbitrary bytes on Render.
    const contentType = req.headers.get("content-type") || "";
    if (!/^multipart\/form-data;\s*boundary=/i.test(contentType) || !req.body) return cardJson({ error: "formulaire_invalide" }, 400);
    const reader = req.body.getReader(), chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > 6 * 1024 * 1024) {
          await reader.cancel();
          return cardJson({ error: "image_trop_lourde" }, 413);
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const form = await new Request(req.url, {
      method: "POST",
      headers: { "content-type": contentType },
      body: new Blob([new Uint8Array(Buffer.concat(chunks))]),
    }).formData();
    const file = form.get("file"), slot = form.get("slot") as CardSlot;
    if (!(file instanceof File) || !CARD_SLOTS.includes(slot) || !["image/jpeg", "image/png"].includes(file.type) || file.size > 5 * 1024 * 1024) return cardJson({ error: "image_invalide_maximum_5_mo" }, 400);
    const input = Buffer.from(await file.arrayBuffer());
    const processed = await processSchoolCardSignature(input, { removeBackground: form.get("removeBackground") === "true", tolerance: Number(form.get("tolerance") || 24), crop: form.get("crop") === "true" });
    if (form.get("action") === "preview") return cardJson({ preview: `data:image/png;base64,${processed.toString("base64")}` });
    if (form.get("action") !== "save" || Number(form.get("revision")) !== ctx.revision || form.get("authorized") !== "true") return cardJson({ error: "validation_ou_revision_invalide" }, 409);
    // The bucket must already exist and remain private. Never create a public bucket.
    const bucket = await ctx.service.storage.getBucket("signatures");
    if (bucket.error || bucket.data.public) return cardJson({ error: "stockage_prive_indisponible" }, 503);
    const base = `school-cards/${ctx.instId}/${slot}/${randomUUID()}`;
    const original = `${base}/original.${file.type === "image/png" ? "png" : "jpg"}`, output = `${base}/processed.png`;
    const first = await ctx.service.storage.from("signatures").upload(original, input, { contentType: file.type, upsert: false });
    if (first.error) throw Error("upload_failed");
    const second = await ctx.service.storage.from("signatures").upload(output, processed, { contentType: "image/png", upsert: false });
    if (second.error) { await ctx.service.storage.from("signatures").remove([original]); throw Error("upload_failed"); }
    const configuration = { ...ctx.configuration, signatures: { ...ctx.configuration.signatures, [slot]: { original, processed: output, updatedAt: new Date().toISOString() } } };
    const record = { institution_id: ctx.instId, configuration, revision: ctx.revision + 1, updated_by: ctx.user.id, updated_at: new Date().toISOString() };
    const result = ctx.revision === 0
      ? await ctx.service.from("school_card_settings").insert(record).select("revision").single()
      : await ctx.service.from("school_card_settings").update(record).eq("institution_id", ctx.instId).eq("revision", ctx.revision).select("revision").maybeSingle();
    if (result.error || !result.data) {
      await ctx.service.storage.from("signatures").remove([original, output]);
      return cardJson({ error: "configuration_modifiee_recharger" }, 409);
    }
    // Keep previous originals for correction/history; no destructive replacement.
    return cardJson({ ok: true, revision: result.data.revision });
  } catch { return cardJson({ error: "traitement_image_impossible_ajuster_les_options" }, 400); }
}

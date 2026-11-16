import { readFile } from "node:fs/promises";
import { join } from "node:path";
import PDFDocument from "pdfkit";
import { PDFParse } from "pdf-parse";
import sharp from "sharp";
import { drawSchoolCard } from "@/lib/school-card-pdf";
import { CARD_HEIGHT_MM, CARD_WIDTH_MM } from "@/lib/school-cards";
import { cardSignatureImages, cardStampImages, productionCardVisuals, type CardScope } from "./school-cards";
import type { SchoolCard } from "@/lib/school-cards";

let cardFont: Promise<Buffer> | undefined;
let previewsInFlight = 0;

export async function protectedCardPreview(ctx: CardScope, item: SchoolCard) {
  if (previewsInFlight >= 2) throw Error("apercu_occupe_reessayer");
  previewsInFlight += 1;
  try { return await renderPreview(ctx, item); }
  finally { previewsInFlight -= 1; }
}

async function previewSource(source: string | null, trustedOrigins: (string | undefined)[]) {
  if (!source) return;
  const localImage = /^data:image\/(?:png|jpe?g|webp);base64,([a-z0-9+/=]+)$/i.exec(source);
  if (localImage && localImage[1].length <= 7_000_000) return Buffer.from(localImage[1], "base64");
  if (!/^https?:\/\//i.test(source)) return;
  const url = new URL(source);
  const allowed = trustedOrigins.some(origin => {
    try { return Boolean(origin) && new URL(origin!).origin === url.origin; }
    catch { return false; }
  });
  if (!allowed || !["https:", "http:"].includes(url.protocol) || url.username || url.password) return;
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(8000), cache: "no-store" });
  if (!response.ok || !response.body) throw Error("visuel_indisponible");
  let total = 0;
  const chunks = [];
  for await (const part of response.body as unknown as AsyncIterable<Uint8Array>) {
    total += part.byteLength;
    if (total > 5 * 1024 * 1024) throw Error("visuel_trop_volumineux");
    chunks.push(part);
  }
  return Buffer.concat(chunks, total);
}

async function lowResImage(source: Promise<Buffer | undefined>, width: number, height: number) {
  const bytes = await source;
  if (!bytes) return;
  const jpeg = await sharp(bytes, { limitInputPixels: 20_000_000 }).rotate()
    .resize({ width, height, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#fff" }).jpeg({ quality: 79 }).toBuffer();
  return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
}

// The preview response contains two flattened raster images only. The print
// layout is reused, but vector text and original assets never leave this route.
async function renderPreview(ctx: CardScope, item: SchoolCard) {
  const [card] = productionCardVisuals(ctx, [item]);
  const slots = new Set(card.signatureSlot ? [card.signatureSlot] : []);
  const trusted = [process.env.SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SCHOOL_CARD_PUBLIC_ORIGIN];
  const [font, logo, photo, signatures, stamps] = await Promise.all([
    cardFont ??= readFile(join(process.cwd(), "public/card-fonts/DejaVuSans.ttf")),
    lowResImage(previewSource(ctx.school.logo_url, trusted), 150, 150),
    lowResImage(previewSource(item.photoUrl, trusted), 105, 125),
    cardSignatureImages(ctx, slots),
    cardStampImages(ctx, slots),
  ]);
  const doc = new PDFDocument({ autoFirstPage: false, margin: 0 });
  const chunks: Buffer[] = [];
  const pdf = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", chunk => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });
  const photos = new Map<string, string>();
  if (photo) photos.set(item.studentId, photo);
  doc.registerFont("card", font);
  const width = CARD_WIDTH_MM * 72 / 25.4, height = CARD_HEIGHT_MM * 72 / 25.4;
  for (const side of ["front", "back"] as const) {
    doc.addPage({ size: [width, height], margin: 0 });
    drawSchoolCard(doc, card, ctx.school, { font, logo, photos, signatures, stamps }, side);
  }
  doc.end();
  const parser = new PDFParse({ data: new Uint8Array(await pdf), useSystemFonts: false, isEvalSupported: false });
  try {
    const { pages } = await parser.getScreenshot({ desiredWidth: 480, imageDataUrl: false, imageBuffer: true });
    const encoded = await Promise.all(pages.map(async page => {
      const jpeg = await sharp(page.data).jpeg({ quality: 76 }).toBuffer();
      return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
    }));
    if (!encoded[0] || !encoded[1]) throw Error("apercu_incomplet");
    return { front: encoded[0], back: encoded[1] };
  } finally { await parser.destroy(); }
}

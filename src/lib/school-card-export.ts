import { renderCardPages } from "./school-card-pdf";
import type { CardSchool, PreparedCard, CardSlot } from "./school-cards";

async function browserImage(url: string, maxWidth: number, maxHeight: number): Promise<string> {
  const image = new Image(); image.crossOrigin = "anonymous";
  image.src = url;
  await Promise.race([image.decode(), new Promise((_, reject) => setTimeout(() => reject(Error("image_timeout")), 15_000))]);
  const scale = Math.min(1, maxWidth / image.naturalWidth, maxHeight / image.naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#FFFFFF"; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.93);
}
export async function exportSchoolCardPdf(cards: PreparedCard[], school: CardSchool, signatures: Partial<Record<CardSlot, string>>, options: { individual?: boolean; flip?: "long" | "short" } = {}) {
  if (!cards.length || cards.length > 100) throw Error("Le PDF accepte de 1 à 100 cartes par lot.");
  const PDFDocument = (await import("pdfkit/js/pdfkit.standalone.js")).default;
  const fontResponse = await fetch("/card-fonts/DejaVuSans.ttf");
  if (!fontResponse.ok) throw Error("Police d’impression indisponible.");
  const font = new Uint8Array(await fontResponse.arrayBuffer()), photos = new Map<string,string>(), missing: string[] = [];
  // At most four image decodes concurrently. No per-pupil auth/SQL requests:
  // these are direct private Storage downloads from the grouped signed URLs.
  for (let i = 0; i < cards.length; i += 4) await Promise.all(cards.slice(i, i + 4).map(async card => {
    if (!card.photoUrl || photos.has(card.studentId)) return;
    try { photos.set(card.studentId, await browserImage(card.photoUrl, 320, 420)); }
    catch { missing.push(card.name); }
  }));
  let logo: string | undefined;
  if (school.logo_url) try { logo = await browserImage(school.logo_url, 300, 300); } catch { missing.push("Logo de l’établissement"); }
  const doc = new PDFDocument({ autoFirstPage: false, bufferPages: false, compress: true, info: { Title: "Cartes scolaires - Mon Cahier", Author: "Mon Cahier" } });
  const chunks: Uint8Array[] = [];
  const result = new Promise<Blob>((resolve, reject) => {
    doc.on("data", chunk => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(new Blob(chunks as BlobPart[], { type: "application/pdf" })));
  });
  renderCardPages(doc, cards, school, { font, logo, photos, signatures }, options);
  doc.end();
  return { blob: await result, missing };
}

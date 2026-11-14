import { renderCardPages } from "./school-card-pdf";
import { usesEpcSchoolCardLayout, type CardSchool, type PreparedCard, type CardSlot } from "./school-cards";

let fontLoad: Promise<Uint8Array> | undefined;
function cardFont() {
  return fontLoad ??= (async () => {
    const response = await fetch("/card-fonts/DejaVuSans.ttf");
    if (!response.ok) throw Error("Police d’impression indisponible.");
    return new Uint8Array(await response.arrayBuffer());
  })().catch(error => { fontLoad = undefined; throw error; });
}

async function browserImageCanvas(url: string, maxWidth: number, maxHeight: number) {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = url;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      image.decode(),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(Error("image_timeout")), 15_000); }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
  const scale = Math.min(1, maxWidth / image.naturalWidth, maxHeight / image.naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#FFFFFF";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return { canvas, context };
}

type CardLogo = { logo?: string; watermark?: string };
let cachedLogo: { url: string; withWatermark: boolean; result: Promise<CardLogo> } | undefined;

export function loadSchoolCardLogo(school: CardSchool): Promise<CardLogo> {
  const url = school.logo_url;
  if (!url) return Promise.resolve({});
  const withWatermark = usesEpcSchoolCardLayout(school);
  if (cachedLogo?.url === url && cachedLogo.withWatermark === withWatermark) return cachedLogo.result;

  const result = browserImageCanvas(url, 300, 300).then(({ canvas, context }) => {
    const logo = canvas.toDataURL("image/jpeg", 0.93);
    if (!withWatermark) return { logo };

    // Convert the white-backed logo into pale green ink, keeping its light areas transparent.
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const luminance = 0.2126 * pixels.data[i] + 0.7152 * pixels.data[i + 1] + 0.0722 * pixels.data[i + 2];
      pixels.data[i] = 19;
      pixels.data[i + 1] = 74;
      pixels.data[i + 2] = 53;
      pixels.data[i + 3] = 255 * 0.05 * Math.max(0, (242 - luminance) / 242);
    }
    context.putImageData(pixels, 0, 0);
    return { logo, watermark: canvas.toDataURL("image/png") };
  }).catch(error => {
    if (cachedLogo?.result === result) cachedLogo = undefined;
    throw error;
  });
  cachedLogo = { url, withWatermark, result };
  return result;
}

export async function exportSchoolCardPdf(cards: PreparedCard[], school: CardSchool, signatures: Partial<Record<CardSlot, string>>, options: { individual?: boolean; flip?: "long" | "short"; stamps?: Partial<Record<CardSlot, string>> } = {}) {
  if (!cards.length || cards.length > 100) throw Error("Le PDF accepte de 1 à 100 cartes par lot.");
  const PDFDocument = (await import("pdfkit/js/pdfkit.standalone.js")).default;
  // All batches/reprints share the immutable font in this page session.
  const font = await cardFont(), photos = new Map<string,string>(), missing: string[] = [];
  // At most four image decodes concurrently. No per-pupil auth/SQL requests:
  // these are direct private Storage downloads from the grouped signed URLs.
  for (let i = 0; i < cards.length; i += 4) await Promise.all(cards.slice(i, i + 4).map(async card => {
    if (!card.photoUrl || photos.has(card.studentId)) return;
    try {
      const { canvas } = await browserImageCanvas(card.photoUrl, 320, 420);
      photos.set(card.studentId, canvas.toDataURL("image/jpeg", 0.93));
    }
    catch { missing.push(card.name); }
  }));
  const brand = await loadSchoolCardLogo(school).catch((): CardLogo => {
    missing.push("Logo de l’établissement");
    return {};
  });
  const doc = new PDFDocument({ autoFirstPage: false, bufferPages: false, compress: true, info: { Title: "Cartes scolaires - Mon Cahier", Author: "Mon Cahier" } });
  const chunks: Uint8Array[] = [];
  const result = new Promise<Blob>((resolve, reject) => {
    doc.on("data", chunk => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(new Blob(chunks as BlobPart[], { type: "application/pdf" })));
  });
  renderCardPages(doc, cards, school, { font, ...brand, photos, signatures, stamps: options.stamps }, options);
  doc.end();
  return { blob: await result, missing };
}

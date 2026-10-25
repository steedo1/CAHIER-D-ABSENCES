import QRCode from "qrcode";
import type PDFKit from "pdfkit";
import { hasCardRtlText, schoolCardTextRuns } from "./school-card-bidi";
import { documentNationalEmblem } from "./document-national-emblem";
import { CARD_WIDTH_MM, CARD_HEIGHT_MM, cardSheetPosition, schoolCardMinistry, type CardSchool, type PreparedCard, type CardSlot } from "./school-cards";

export type CardPrintAssets = { font: Uint8Array; logo?: string; photos: Map<string, string>; signatures: Partial<Record<CardSlot, string>> };
const mm = (value: number) => value * 72 / 25.4;
const green = "#13633E", orange = "#F08426";
function rtlText(doc: PDFKit.PDFDocument, label: string, x: number, y: number, w: number, h: number, size: number, align: "left" | "center" | "right") {
  const width = (value: string) => schoolCardTextRuns(value).reduce((sum, run) => sum + doc.widthOfString(run.text, { features: [] }), 0);
  const wrap = () => {
    const lines: string[] = []; let line = "";
    for (const word of label.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (line && width(next) > mm(w)) { lines.push(line); line = word; } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  };
  let fontSize = size; doc.fontSize(fontSize); let lines = wrap();
  while (fontSize > 4.2 && (lines.length * doc.currentLineHeight(true) > mm(h) || lines.some(line => width(line) > mm(w)))) {
    fontSize = Math.max(4.2, fontSize - 0.2); doc.fontSize(fontSize); lines = wrap();
  }
  const lineHeight = doc.currentLineHeight(true), limit = Math.max(1, Math.floor(mm(h) / lineHeight));
  lines = lines.slice(0, limit);
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (width(line) > mm(w) || (i === limit - 1 && wrap().length > limit)) {
      while (line && width(`${line}…`) > mm(w)) line = Array.from(line).slice(0, -1).join("");
      line += "…";
    }
    const runs = schoolCardTextRuns(line), lineWidth = width(line);
    const effectiveAlign = align === "left" && /^[\s\p{P}\p{N}]*[\p{Script=Arabic}\p{Script=Hebrew}]/u.test(line) ? "right" : align;
    let cursor = mm(x) + (effectiveAlign === "center" ? (mm(w) - lineWidth) / 2 : effectiveAlign === "right" ? mm(w) - lineWidth : 0);
    for (const run of runs) {
      // Explicit features bypass PDFKit's per-space layout cache, which otherwise
      // shapes Arabic words separately and concatenates them in Latin order.
      doc.text(run.text, cursor, mm(y) + i * lineHeight, { lineBreak: false, features: [] });
      cursor += doc.widthOfString(run.text, { features: [] });
    }
  }
}
function text(doc: PDFKit.PDFDocument, value: unknown, x: number, y: number, w: number, h: number, size = 6, align: "left" | "center" | "right" = "left") {
  const label = String(value || "—");
  if (hasCardRtlText(label)) { rtlText(doc, label, x, y, w, h, size, align); return; }
  let fontSize = size;
  doc.fontSize(fontSize);
  while (fontSize > 4.2 && doc.widthOfString(label) > mm(w) * (h > 4 ? 1.9 : 1)) { fontSize -= 0.2; doc.fontSize(fontSize); }
  doc.text(label, mm(x), mm(y), { width: mm(w), height: mm(h), align, lineBreak: true, ellipsis: true, lineGap: 0 });
}
function imageFit(doc: PDFKit.PDFDocument, source: string | undefined, x: number, y: number, w: number, h: number) {
  if (source) doc.image(source, mm(x), mm(y), { fit: [mm(w), mm(h)], align: "center", valign: "center" });
}
function drawQr(doc: PDFKit.PDFDocument, url: string, x: number, y: number, size: number) {
  const qr = QRCode.create(url, { errorCorrectionLevel: "M" });
  const n = qr.modules.size, unit = size / (n + 8);
  doc.fillColor("#FFFFFF").rect(mm(x), mm(y), mm(size), mm(size)).fill();
  doc.fillColor("#000000");
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (qr.modules.get(r, c)) doc.rect(mm(x + (c + 4) * unit), mm(y + (r + 4) * unit), mm(unit + 0.008), mm(unit + 0.008));
  }
  doc.fill();
}
/** Shared by the browser exporter and the Node layout/performance tests.
 * Vector text/QR and physical units: no screenshot scaling or server PDF work. */
export function drawSchoolCard(doc: PDFKit.PDFDocument, card: PreparedCard, school: CardSchool, assets: CardPrintAssets, side: "front" | "back", x = 0, y = 0) {
  doc.save().translate(mm(x), mm(y));
  doc.roundedRect(0, 0, mm(CARD_WIDTH_MM), mm(CARD_HEIGHT_MM), mm(3)).fillAndStroke("#FFFFFF", "#D7E1DB");
  doc.save().roundedRect(0, 0, mm(CARD_WIDTH_MM), mm(CARD_HEIGHT_MM), mm(3)).clip();
  doc.font("card").fillColor(green);
  if (side === "front") {
    const nationalEmblem = documentNationalEmblem(school.country_name);
    const headerWidth = nationalEmblem ? 55 : 66;
    imageFit(doc, assets.logo, 3, 2, 10, 10);
    imageFit(doc, nationalEmblem, 73, 2, 9.6, 9.6);
    text(doc, school.country_name || "République de Côte d’Ivoire", 15, 2, headerWidth, 3, 5.9, "center");
    doc.fillColor("#3C4942"); text(doc, school.country_motto || "Union - Discipline - Travail", 15, 5.3, headerWidth, 2.5, 4.7, "center");
    const ministry = schoolCardMinistry(school, card.year);
    if (ministry) text(doc, ministry, 15, 8, headerWidth, 4, 4.2, "center");
    doc.roundedRect(mm(28), mm(12), mm(40), mm(4.7), mm(0.8)).fill(green);
    doc.fillColor("#FFFFFF"); text(doc, "CARTE SCOLAIRE", 28, 12.5, 40, 4, 8.2, "center");
    doc.fillColor("#273C30"); text(doc, `ANNÉE SCOLAIRE ${card.year}`, 27, 17.2, 51, 3, 5.5, "center");
    doc.roundedRect(mm(3.6), mm(19.5), mm(20), mm(26), mm(1)).fillAndStroke("#F1F5F2", "#CCD7CE");
    imageFit(doc, assets.photos.get(card.studentId), 3.9, 19.8, 19.4, 25.4);
    if (!assets.photos.has(card.studentId)) { doc.fillColor("#65776B"); text(doc, "Photo absente", 5, 29, 17, 8, 5.2, "center"); }
    doc.fillColor("#151C17");
    text(doc, `Matricule : ${card.matricule || "Non renseigné"}`, 26, 21.5, 56, 3.8, 6.4);
    text(doc, card.name, 26, 26, 56, 6, 7.2);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(card.birthdate) ? card.birthdate.split("-").reverse().join("/") : "Non renseignée";
    text(doc, `Né(e) le : ${date}   Sexe : ${card.gender || "—"}`, 26, 33, 56, 3.5, 5.5);
    text(doc, `Lieu : ${card.birthPlace || "Non renseigné"}`, 26, 37, 56, 3.6, 5.7);
    text(doc, `Classe : ${card.classLabel}`, 26, 41.1, 29, 5, 6.3);
    if (card.signatureSlot) imageFit(doc, assets.signatures[card.signatureSlot], 59, 39.7, 23, 7.6);
    doc.fillColor("#56675C");
    if (card.signatureSlot) text(doc, card.signatoryName, 56, 46, 27, 2, 3.8, "center");
    doc.rect(mm(3), mm(48.4), mm(79.6), mm(0.6)).fill(orange);
    doc.fillColor(green); text(doc, school.name, 4, 49.6, 77.6, 3.3, 6.8, "center");
  } else {
    doc.rect(0, 0, mm(CARD_WIDTH_MM), mm(1.6)).fill(green);
    imageFit(doc, assets.logo, 5, 4, 15, 12);
    doc.fillColor(green); text(doc, school.name, 23, 5, 57, 9, 7.3, "center");
    doc.fillColor("#2C3D32");
    text(doc, "Cette carte est strictement personnelle. Elle accompagne les démarches scolaires et administratives de son titulaire.", 5, 19, 51, 10.5, 6.1);
    text(doc, "Toute reproduction, altération ou utilisation frauduleuse est interdite.", 5, 31, 51, 8, 5.7);
    text(doc, `En cas de perte, contacter l’établissement : ${school.phone || "coordonnées à renseigner"}`, 5, 40, 51, 7, 5.6);
    drawQr(doc, card.verificationUrl, 60.2, 20, 22.5);
    doc.fillColor(green); text(doc, "VÉRIFIER LA CARTE", 59, 17, 25, 3, 4.6, "center");
    doc.fillColor("#526659"); text(doc, card.fingerprint, 60, 43, 23, 3, 4.3, "center");
    doc.rect(mm(4), mm(48.3), mm(77.6), mm(0.4)).fill(orange);
    doc.fillColor(green); text(doc, "Générée par Mon Cahier — www.mon-cahier.com", 4, 50, 77.6, 2.7, 5.6, "center");
  }
  doc.restore().restore();
}
function cutMarks(doc: PDFKit.PDFDocument, x: number, y: number) {
  doc.save().strokeColor("#AAB8AE").lineWidth(0.25);
  for (const dx of [0, CARD_WIDTH_MM]) for (const dy of [0, CARD_HEIGHT_MM]) {
    const px = x + dx, py = y + dy;
    doc.moveTo(mm(px + (dx ? 0.5 : -2)), mm(py)).lineTo(mm(px + (dx ? 2 : -0.5)), mm(py)).stroke();
    doc.moveTo(mm(px), mm(py + (dy ? 0.5 : -2))).lineTo(mm(px), mm(py + (dy ? 2 : -0.5))).stroke();
  }
  doc.restore();
}
export function renderCardPages(doc: PDFKit.PDFDocument, cards: PreparedCard[], school: CardSchool, assets: CardPrintAssets, options: { individual?: boolean; flip?: "long" | "short" } = {}) {
  doc.registerFont("card", assets.font as any);
  const perPage = options.individual ? 1 : 10;
  for (let offset = 0; offset < cards.length; offset += perPage) {
    for (const side of ["front", "back"] as const) {
      doc.addPage({ size: options.individual ? [mm(CARD_WIDTH_MM), mm(CARD_HEIGHT_MM)] : "A4", margin: 0 });
      cards.slice(offset, offset + perPage).forEach((card, index) => {
        const position = options.individual ? { x: 0, y: 0 } : cardSheetPosition(index, side, options.flip);
        drawSchoolCard(doc, card, school, assets, side, position.x, position.y);
        if (!options.individual) cutMarks(doc, position.x, position.y);
      });
    }
  }
}

import type PDFKit from "pdfkit";
import { hasCardRtlText, schoolCardTextRuns } from "./school-card-bidi";
import { documentNationalEmblem } from "./document-national-emblem";
import { CARD_WIDTH_MM, CARD_HEIGHT_MM, cardSheetPosition, schoolCardMinistry, usesEpcSchoolCardLayout, EPC_CARD_DIRECTOR, EPC_CARD_USAGE, EPC_CARD_REPRODUCTION, type CardSchool, type PreparedCard, type CardSlot } from "./school-cards";

export type CardPrintAssets = { font: Uint8Array; logo?: string; photos: Map<string, string>; signatures: Partial<Record<CardSlot, string>>; stamps?: Partial<Record<CardSlot, string>> };
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
function drawEpcSchoolCard(doc: PDFKit.PDFDocument, card: PreparedCard, school: CardSchool, assets: CardPrintAssets, side: "front" | "back") {
  const ink = "#192923", muted = "#485D53", darkGreen = "#134A35", paper = "#F3F7F4";
  const rect = (x: number, y: number, w: number, h: number, color: string, radius = 0) =>
    doc.roundedRect(mm(x), mm(y), mm(w), mm(h), mm(radius)).fill(color);

  if (side === "front") {
    imageFit(doc, assets.logo, 4.5, 2.2, 8, 9.1);
    imageFit(doc, documentNationalEmblem(school.country_name), 73, 2.2, 8.1, 9.1);
    doc.fillColor(darkGreen);
    text(doc, (school.country_name || "République de Côte d’Ivoire").toLocaleUpperCase("fr"), 14, 2.0, 57.6, 3.4, 6.6, "center");
    doc.fillColor(muted);
    text(doc, school.country_motto || "Union - Discipline - Travail", 14, 5.2, 57.6, 2.7, 5.35, "center");
    const ministry = schoolCardMinistry(school, card.year);
    if (ministry) text(doc, ministry, 14, 7.9, 57.6, 5, 5.05, "center");

    rect(4, 13.5, 77.6, 7, darkGreen, 1.2);
    doc.fillColor("#FFFFFF");
    text(doc, "CARTE SCOLAIRE", 7.1, 14.6, 49, 5, 10);
    text(doc, card.year, 59, 15.3, 19.2, 4, 7.6, "right");

    rect(4, 23, 20, 24, paper, 1.4);
    const photo = assets.photos.get(card.studentId);
    imageFit(doc, photo, 4.6, 23.6, 18.8, 22.8);
    if (!photo) {
      doc.fillColor(muted);
      text(doc, "Photo absente", 4.5, 33.1, 19, 5, 5.7, "center");
    }

    doc.fillColor(muted);
    text(doc, "NOM ET PRÉNOMS", 28, 22.5, 53.6, 3.3, 5.7);
    doc.fillColor(darkGreen);
    text(doc, card.name, 28, 25.5, 53.6, 6.3, 10.5);
    doc.fillColor(muted);
    text(doc, "MATRICULE", 28, 32.0, 25, 2.6, 5.7);
    text(doc, "CLASSE", 55, 32.0, 26.6, 2.6, 5.7);
    doc.fillColor(ink);
    text(doc, card.matricule, 28, 34.9, 25, 4, 8.1);
    text(doc, card.classLabel, 55, 34.9, 26.6, 4, 8.1);
    doc.fillColor(muted);
    text(doc, "NÉ(E) LE", 28, 40.0, 23, 2.6, 5.7);
    text(doc, "À", 51, 40.0, 23.5, 2.6, 5.7);
    text(doc, "SEXE", 75, 40.0, 6.6, 2.6, 5.7);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(card.birthdate) ? card.birthdate.split("-").reverse().join("/") : "";
    doc.fillColor(ink);
    text(doc, date, 28, 43.1, 22, 3.8, 7.5);
    text(doc, card.birthPlace, 51, 43.1, 23.5, 5.8, 7.4);
    text(doc, card.gender, 75, 43.1, 6.6, 3.8, 7.5);
  } else {
    rect(4, 3.9, 77.6, 7.6, paper, 1.2);
    imageFit(doc, assets.logo, 5.4, 4.8, 5.8, 5.7);
    doc.fillColor(darkGreen);
    text(doc, school.name, 13, 5.6, 67, 4.8, 7.9);
    const slot = card.signatureSlot;
    const signature = slot ? assets.signatures[slot] : undefined;
    const stamp = slot ? assets.stamps?.[slot] : undefined;
    const showDirector = (slot === "french" || slot === "arabic") && Boolean(signature || stamp);
    const noticeWidth = showDirector ? 33.8 : 75.6;
    const noticeAlign = showDirector ? "left" : "center";
    doc.fillColor(darkGreen);
    text(doc, "UTILISATION DE LA CARTE", 5, 15.4, noticeWidth, 3.3, 6.2, noticeAlign);
    doc.fillColor(ink);
    text(doc, EPC_CARD_USAGE, 5, 19.2, noticeWidth, 11, 6.0, noticeAlign);
    doc.fillColor(darkGreen);
    text(doc, school.phone ? "En cas de perte, appeler le" : "En cas de perte, contacter", 5, 31.5, noticeWidth, 3.0, 6.1, noticeAlign);
    text(doc, school.phone || "l’établissement.", 5, 35.0, noticeWidth, 4, 6.5, noticeAlign);
    doc.fillColor(muted);
    text(doc, EPC_CARD_REPRODUCTION, 5, 41.0, noticeWidth, 7.1, 5.6, noticeAlign);
    if (showDirector && (slot === "french" || slot === "arabic")) {
      rect(40, 14.1, 0.28, 33.1, "#CBDAD1");
      doc.fillColor(darkGreen);
      text(doc, EPC_CARD_DIRECTOR[slot].toLocaleUpperCase("fr"), 41, 14.3, 41.2, 3, 5.2, "center");
      imageFit(doc, stamp, 50.6, 18.1, 22, 20.4);
      imageFit(doc, signature, 49.1, 39.1, 25, 6.3);
      doc.fillColor(ink);
      text(doc, card.signatoryName, 41, 45.8, 41.2, 3.5, 6.5, "center");
    }
  }
  rect(4, 50, 77.6, 0.35, "#DAA754");
  doc.fillColor(side === "front" ? darkGreen : muted);
  text(doc, side === "front" ? school.name : "Mon Cahier · www.mon-cahier.com", 4, 50.9, 77.6, 2.9, 5.5);
}

/** Shared by the browser exporter and the Node layout/performance tests.
 * Vector text and physical units: no screenshot scaling or server PDF work. */
export function drawSchoolCard(doc: PDFKit.PDFDocument, card: PreparedCard, school: CardSchool, assets: CardPrintAssets, side: "front" | "back", x = 0, y = 0) {
  doc.save().translate(mm(x), mm(y));
  doc.roundedRect(0, 0, mm(CARD_WIDTH_MM), mm(CARD_HEIGHT_MM), mm(3)).fillAndStroke("#FFFFFF", "#D7E1DB");
  doc.save().roundedRect(0, 0, mm(CARD_WIDTH_MM), mm(CARD_HEIGHT_MM), mm(3)).clip();
  doc.font("card").fillColor(green);
  if (usesEpcSchoolCardLayout(school)) {
    drawEpcSchoolCard(doc, card, school, assets, side);
  } else if (side === "front") {
    // Reference-inspired identity layout. All assets are reused from the current
    // client-side PDF export; this section makes no additional HTTP/SQL calls.
    const nationalEmblem = documentNationalEmblem(school.country_name);
    imageFit(doc, assets.logo, 2.7, 1.6, 11, 11.5);
    imageFit(doc, nationalEmblem, 73.5, 1.6, 9, 10);
    doc.fillColor(orange);
    text(doc, school.country_name || "République de Côte d’Ivoire", 15, 2.1, 55.5, 3, 6.2, "center");
    doc.fillColor("#404A44");
    text(doc, school.country_motto || "Union - Discipline - Travail", 15, 5.3, 55.5, 2.5, 4.8, "center");
    const ministry = schoolCardMinistry(school, card.year);
    if (ministry) text(doc, ministry, 15, 7.8, 55.5, 4.2, 4.1, "center");

    doc.roundedRect(mm(29), mm(12.2), mm(32), mm(4.7), mm(0.8)).fill("#0B7A22");
    doc.fillColor("#FFFFFF");
    text(doc, "CARTE SCOLAIRE", 29, 12.6, 32, 4.1, 8.1, "center");
    doc.fillColor("#343E37");
    text(doc, `ANNÉE SCOLAIRE : ${card.year}`, 24.5, 17.4, 41, 2.7, 5.2, "center");

    doc.roundedRect(mm(4.5), mm(21.2), mm(21.7), mm(24.5), mm(0.6))
      .fillAndStroke("#F4F7F5", "#CBD8D0");
    imageFit(doc, assets.photos.get(card.studentId), 4.8, 21.5, 21.1, 23.9);
    if (!assets.photos.has(card.studentId)) {
      doc.fillColor("#7C8B81");
      text(doc, "Photo absente", 6.2, 30, 18.1, 6, 5.4, "center");
    }

    doc.fillColor("#151C17");
    text(doc, "Matricule :", 28, 21.6, 16, 3.3, 6.1);
    text(doc, card.matricule || "Non renseigné", 43, 21.3, 39, 4, 7.4);
    text(doc, "Nom et Prénoms :", 28, 26.1, 50, 2.8, 6.0);
    text(doc, card.name, 28, 29.1, 54, 4.5, 7.7);

    const date = /^\d{4}-\d{2}-\d{2}$/.test(card.birthdate)
      ? card.birthdate.split("-").reverse().join("/") : "Non renseignée";
    text(doc, "Date de naissance :", 28, 34.4, 21.5, 3, 5.3);
    text(doc, date, 49.6, 34.2, 19, 3.5, 6.0);
    text(doc, "Sexe :", 69, 34.4, 8, 3, 5.3);
    text(doc, card.gender || "—", 77.5, 34.2, 5, 3.5, 6.0);
    text(doc, "Lieu de naissance :", 28, 38.6, 21, 3.1, 5.3);
    text(doc, card.birthPlace || "Non renseigné", 49, 38.4, 33, 3.8, 5.9);
    text(doc, "Classe :", 28, 42.7, 11.5, 3.2, 6.0);
    const signature = card.signatureSlot ? assets.signatures[card.signatureSlot] : undefined;
    text(doc, card.classLabel, 39.5, 42.5, signature ? 20 : 42.5, 4, 6.5);

    if (signature) {
      imageFit(doc, signature, 61, 41.3, 21, 5.7);
      doc.fillColor("#526058");
      text(doc, card.signatoryName, 58.5, 46.4, 24, 1.9, 3.7, "center");
    }
    doc.rect(mm(3.5), mm(48.5), mm(78.6), mm(0.7)).fill(orange);
    doc.fillColor("#181F1A");
    text(doc, school.name, 4.0, 49.8, 77.6, 3.1, 7.1, "center");
  } else {
    // QR-free reverse: institutional identity and legal notices from the visual reference.
    // No scanning, QR drawing, or per-card PDF work on the server.
    imageFit(doc, assets.logo, 29, 3.1, 27.6, 17.5);
    const stamp = card.signatureSlot ? assets.stamps?.[card.signatureSlot] : undefined;
    // Each card reuses the once-loaded school seal, never another HTTP request.
    // The seal stays on the reverse, without obscuring student details.
    imageFit(doc, stamp, 59.3, 2.0, 22.5, 22.5);
    doc.fillColor("#17211B");
    text(doc, school.name, 4.5, stamp ? 25.0 : 22, 76.6, stamp ? 3.7 : 4.6, stamp ? 6.5 : 7.1, "center");

    doc.fillColor("#27342B");
    text(doc, "Cette carte est strictement personnelle et obligatoire pour toutes les démarches scolaires et administratives.",
      8, stamp ? 30.0 : 29, 69.6, stamp ? 6.0 : 6.5, 5.8, "center");
    text(doc, "Toute reproduction, altération ou utilisation frauduleuse est formellement interdite.",
      8, 36.5, 69.6, 5.6, 5.7, "center");
    text(doc, `En cas de perte, prière de contacter l’établissement au : ${school.phone || "coordonnées à renseigner"}`,
      8, 43.4, 69.6, 5.2, 5.5, "center");

    doc.rect(mm(3.5), mm(50.3), mm(78.6), mm(0.5)).fill(orange);
    doc.fillColor("#536157");
    text(doc, "Mon Cahier — www.mon-cahier.com", 4, 51.3, 77.6, 2.0, 4.7, "center");
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

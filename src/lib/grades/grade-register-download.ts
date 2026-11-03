import type { GradeRegisterPrintInput, GradeRegisterEvaluation } from "./grade-register-print";

/**
 * PDF téléchargeable directement dans la PWA, depuis les notes déjà chargées.
 * Aucun aller-retour vers Supabase ou Render au moment de l'export.
 */
let fontPromise: Promise<Uint8Array> | undefined;
function loadFont() {
  return fontPromise ??= fetch("/card-fonts/DejaVuSans.ttf", { cache: "force-cache" })
    .then(async (response) => {
      if (!response.ok) throw new Error("Police d'impression indisponible.");
      return new Uint8Array(await response.arrayBuffer());
    })
    .catch((error) => { fontPromise = undefined; throw error; });
}

function gradeLabel(value: unknown): string {
  if (value === null || value === undefined || typeof value !== "number" || !Number.isFinite(value)) return "—";
  return value.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
}

function normalName(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export async function downloadGradeRegisterPdf(input: GradeRegisterPrintInput): Promise<string> {
  if (!input.students.length || !input.evaluations.length) {
    throw new Error("Aucune note à exporter.");
  }
  if (input.evaluations.length > 80 || input.students.length > 600) {
    throw new Error("Registre trop volumineux pour un seul export PDF.");
  }

  // Chargé uniquement lors du clic d'export ; le module principal reste léger.
  const PDFDocument = (await import("pdfkit/js/pdfkit.standalone.js")).default;
  const font = await loadFont();
  const doc = new PDFDocument({
    size: "A4", layout: "landscape", margin: 30, autoFirstPage: false, compress: true,
    info: { Title: "Registre des notes - " + input.className, Creator: "Mon Cahier" },
  });
  const chunks: Uint8Array[] = [];
  const pdfReady = new Promise<Blob>((resolve, reject) => {
    doc.on("data", (chunk: Uint8Array) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(new Blob(chunks as BlobPart[], { type: "application/pdf" })));
  });
  doc.registerFont("school", font);
  doc.font("school");

  const grades = input.grades;
  const allEvaluations = input.evaluations;
  const students = [...input.students].sort((a, b) =>
    a.full_name.localeCompare(b.full_name, "fr", { numeric: true, sensitivity: "base" }));
  const groups: GradeRegisterEvaluation[][] = [];
  for (let i = 0; i < allEvaluations.length; i += 4) groups.push(allEvaluations.slice(i, i + 4));

  const margin = 30;
  let pageNo = 0;

  function cell(text: string, x: number, y: number, w: number, h: number,
    options: { align?: "left" | "center"; fill?: string; size?: number } = {}) {
    doc.save();
    doc.rect(x, y, w, h).fillAndStroke(options.fill || "#FFFFFF", "#CBD5E1");
    doc.font("school").fontSize(options.size || 9).fillColor("#0F172A");
    doc.text(text, x + 4, y + 3, {
      width: w - 8, height: h - 6, align: options.align || "center", lineBreak: false,
    });
    doc.restore();
  }

  function begin(group: GradeRegisterEvaluation[], groupStart: number) {
    doc.addPage();
    pageNo++;
    const width = doc.page.width - margin * 2;
    const height = doc.page.height;
    doc.font("school").fillColor("#0F172A").fontSize(12)
      .text(normalName(input.institutionName || "Établissement scolaire"), margin, 18,
        { width, align: "center", lineBreak: false });
    doc.fontSize(13).text("REGISTRE DES NOTES", margin, 40, { width, align: "center" });
    doc.fontSize(9).fillColor("#334155").text(
      "Année scolaire : " + normalName(input.academicYear) +
      "    •    Classe : " + normalName(input.className) +
      "    •    Matière : " + normalName(input.subjectName || "Discipline"),
      margin, 62, { width, align: "center" });
    doc.fontSize(8.5).text(
      [input.teachingName, input.periodName].filter(Boolean).map(normalName).join("    •    "),
      margin, 81, { width, align: "center" });
    if (groups.length > 1) doc.fontSize(8).text(
      "Notes " + (groupStart + 1) + " à " + (groupStart + group.length) +
      " sur " + allEvaluations.length,
      margin, 97, { width, align: "center" });
    doc.fontSize(8).fillColor("#64748B")
      .text("Mon Cahier • www.mon-cahier.com    |    Page " + pageNo,
        margin, height - 20, { width, align: "right" });

    const leadWidths = [31, 94, 230];
    const averageWidth = 81;
    const available = width - leadWidths.reduce((a, b) => a + b, 0) - averageWidth;
    const widths = [...leadWidths, ...group.map(() => available / group.length), averageWidth];
    const headings = ["N°", "Matricule", "Nom et prénoms",
      ...group.map((ev, i) =>
        normalName(ev.label || "Note " + (groupStart + i + 1)) + " /" + ev.scale +
        (ev.component ? " • " + normalName(ev.component) : "") +
        (ev.eval_date ? " • " + ev.eval_date.slice(8, 10) + "/" + ev.eval_date.slice(5, 7) : "")),
      "Moy. /20"];
    let x = margin;
    for (let j = 0; j < widths.length; j++) {
      cell(headings[j], x, 120, widths[j], 42, { align: j === 2 ? "left" : "center", fill: "#EEF2F7", size: j >= 3 ? 8.1 : 8.6 });
      x += widths[j];
    }
    return { y: 162, widths, maxY: height - 32 };
  }

  for (let g = 0; g < groups.length; g++) {
    const group = groups[g];
    let page = begin(group, g * 4);
    for (let i = 0; i < students.length; i++) {
      if (page.y + 21 > page.maxY) page = begin(group, g * 4);
      const student = students[i];
      let sum = 0, weight = 0;
      for (const ev of allEvaluations) {
        const value = grades[ev.id]?.[student.id];
        if (typeof value !== "number" || !Number.isFinite(value) || !(Number(ev.scale) > 0)) continue;
        const coeff = Number(ev.coeff) > 0 ? Number(ev.coeff) : 1;
        sum += value / Number(ev.scale) * 20 * coeff;
        weight += coeff;
      }
      const values = [
        String(i + 1),
        normalName(student.matricule || ""),
        normalName(student.full_name),
        ...group.map(ev => gradeLabel(grades[ev.id]?.[student.id])),
        gradeLabel(weight > 0 ? sum / weight : null),
      ];
      let x = margin;
      for (let j = 0; j < values.length; j++) {
        cell(values[j], x, page.y, page.widths[j], 21, {
          align: j === 2 ? "left" : "center",
          fill: j === values.length - 1 ? "#EFF6FF" : i % 2 === 0 ? "#FFFFFF" : "#F8FAFC",
          size: j === 2 ? 8.6 : 8.8,
        });
        x += page.widths[j];
      }
      page.y += 21;
    }
  }
  doc.end();
  const blob = await pdfReady;
  const name = "registre_notes_" +
    normalName(input.className).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 50) +
    "_" + normalName(input.academicYear || "annee") + ".pdf";
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return name;
}

import PDFDocument from "pdfkit";
import { readFileSync } from "node:fs";
import path from "node:path";

export type AdminRegisterPdfEvaluation = {
  id: string;
  column_label?: string | null;
  component_label?: string | null;
  eval_date?: string | null;
  scale: number;
  coeff?: number | null;
  is_published?: boolean;
};

export type AdminRegisterPdfInput = {
  institutionName: string;
  academicYear: string;
  className: string;
  subjectName: string;
  teacherName?: string;
  periodName?: string;
  publicationLabel: string;
  students: Array<{ id: string; full_name: string; matricule?: string | null }>;
  evaluations: AdminRegisterPdfEvaluation[];
  scores: Array<{ evaluation_id: string; student_id: string; score: number | null }>;
};

function numeric(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function scoreLabel(value: number | null) {
  return value === null ? "—" : value.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
}

function fullLabel(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

/** PDF généré sur demande, uniquement depuis la réponse authentifiée du registre. */
export function buildAdminRegisterPdf(input: AdminRegisterPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4", layout: "landscape", margin: 30, autoFirstPage: false,
      compress: true, info: { Title: "Registre des notes - " + input.className, Creator: "Mon Cahier" },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    try {
      // Police Unicode intégrée au dépôt : noms français et arabes.
      const font = readFileSync(path.join(process.cwd(), "public", "card-fonts", "DejaVuSans.ttf"));
      doc.registerFont("school", font);
      doc.font("school");

      const margin = 30;
      const pageWidth = 841.89;
      const pageHeight = 595.28;
      const tableWidth = pageWidth - margin * 2;
      const students = [...input.students].sort((a, b) =>
        a.full_name.localeCompare(b.full_name, "fr", { sensitivity: "base", numeric: true }));
      const evaluations = input.evaluations;
      const gradeLookup = new Map(input.scores.map((s) => [s.evaluation_id + ":" + s.student_id, numeric(s.score)]));
      const maxGradeCols = 4;
      const gradeGroups: AdminRegisterPdfEvaluation[][] = [];
      for (let i = 0; i < evaluations.length; i += maxGradeCols) {
        gradeGroups.push(evaluations.slice(i, i + maxGradeCols));
      }
      if (!gradeGroups.length) gradeGroups.push([]);

      function cell(text: string, x: number, y: number, w: number, h: number, options: {
        align?: "left" | "center" | "right"; bold?: boolean; fill?: string; size?: number;
      } = {}) {
        doc.save();
        doc.rect(x, y, w, h).fillAndStroke(options.fill || "#FFFFFF", "#CBD5E1");
        doc.font("school").fontSize(options.size || 9).fillColor(options.bold ? "#0F172A" : "#1F2937");
        doc.text(text, x + 4, y + 3.5, {
          width: w - 8, height: h - 6, align: options.align || "left",
          lineBreak: false, ellipsis: false,
        });
        doc.restore();
      }

      let pageNumber = 0;
      function beginPage(group: AdminRegisterPdfEvaluation[], fromIndex: number) {
        pageNumber += 1;
        doc.addPage({ size: "A4", layout: "landscape", margin });
        doc.font("school").fillColor("#0F172A").fontSize(12)
          .text(fullLabel(input.institutionName), margin, 20, { width: tableWidth, align: "center", lineBreak: false });
        doc.fontSize(12).text("REGISTRE DES NOTES", margin, 42, { width: tableWidth, align: "center" });
        doc.fontSize(9).fillColor("#334155").text(
          "Année : " + input.academicYear +
          "    •    Classe : " + input.className +
          "    •    Discipline : " + input.subjectName,
          margin, 65, { width: tableWidth, align: "center" },
        );
        doc.fontSize(8).text(
          (input.teacherName ? "Enseignant : " + input.teacherName + "    •    " : "") +
          (input.periodName ? "Période : " + input.periodName + "    •    " : "Toute l'année scolaire    •    ") +
          input.publicationLabel,
          margin, 84, { width: tableWidth, align: "center" },
        );
        if (evaluations.length > 4) {
          doc.fontSize(8).text(
            "Notes " + (fromIndex + 1) + " à " + (fromIndex + group.length) + " sur " + evaluations.length,
            margin, 100, { width: tableWidth, align: "center" },
          );
        }
        doc.fontSize(8).fillColor("#64748B")
          .text("Mon Cahier • www.mon-cahier.com  |  Page " + pageNumber,
            margin, pageHeight - 22, { width: tableWidth, align: "right" });

        const base = [32, 94, 230];
        const avgWidth = 82;
        const notesWidth = tableWidth - base.reduce((a, b) => a + b, 0) - avgWidth;
        const widths = [...base, ...group.map(() => notesWidth / Math.max(1, group.length)), avgWidth];
        let x = margin;
        const y = 125;
        const headH = 42;
        const labels = ["N°", "Matricule", "Nom et prénoms",
          ...group.map((ev, i) =>
            (fullLabel(ev.column_label) || "Note " + (fromIndex + i + 1)) +
            " /" + ev.scale + (ev.component_label ? " • " + fullLabel(ev.component_label) : "") +
            (ev.eval_date ? " • " + ev.eval_date.slice(8, 10) + "/" + ev.eval_date.slice(5, 7) : "")),
          "Moy. /20"];
        for (let i = 0; i < widths.length; i++) {
          cell(labels[i], x, y, widths[i], headH, { align: i === 2 ? "left" : "center", bold: true, fill: "#EEF2F7", size: i >= 3 ? 8.2 : 8.7 });
          x += widths[i];
        }
        return { y: y + headH, widths };
      }

      for (let groupIndex = 0; groupIndex < gradeGroups.length; groupIndex++) {
        const group = gradeGroups[groupIndex];
        const from = groupIndex * maxGradeCols;
        let sheet = beginPage(group, from);
        const rowHeight = 20.5;
        for (let index = 0; index < students.length; index++) {
          if (sheet.y + rowHeight > pageHeight - 32) sheet = beginPage(group, from);
          const student = students[index];
          const valid = evaluations.map((ev) => {
            const grade = gradeLookup.get(ev.id + ":" + student.id);
            if (grade === undefined || grade === null || !(Number(ev.scale) > 0)) return null;
            const coeff = Number(ev.coeff) > 0 ? Number(ev.coeff) : 1;
            return { grade, scale: Number(ev.scale), coeff };
          }).filter((row): row is { grade: number; scale: number; coeff: number } => row !== null);
          const numerator = valid.reduce((sum, item) => sum + item.grade / item.scale * 20 * item.coeff, 0);
          const denominator = valid.reduce((sum, item) => sum + item.coeff, 0);
          const average = denominator > 0 ? numerator / denominator : null;
          const values = [
            String(index + 1),
            fullLabel(student.matricule || ""),
            fullLabel(student.full_name),
            ...group.map((ev) => scoreLabel(gradeLookup.get(ev.id + ":" + student.id) ?? null)),
            scoreLabel(average),
          ];
          let x = margin;
          for (let j = 0; j < values.length; j++) {
            cell(values[j], x, sheet.y, sheet.widths[j], rowHeight, {
              align: j === 2 ? "left" : "center",
              bold: j === 2 || j === values.length - 1,
              fill: j === values.length - 1 ? "#F1F5F9" : index % 2 === 0 ? "#FFFFFF" : "#F8FAFC",
              size: j === 2 ? 8.6 : 8.8,
            });
            x += sheet.widths[j];
          }
          sheet.y += rowHeight;
        }
      }

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

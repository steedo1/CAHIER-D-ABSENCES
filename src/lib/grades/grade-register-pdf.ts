import PDFDocument from "pdfkit";
import path from "node:path";

type Student = { id: string; full_name: string; matricule?: string | null };
type Evaluation = {
  id: string;
  column_label?: string | null;
  eval_date?: string | null;
  scale?: number | null;
  component_label?: string | null;
  eval_kind?: string | null;
  publication_status?: string | null;
  is_published?: boolean;
};
type Score = { evaluation_id: string; student_id: string; score: number | null };

export type AdminRegisterPdfInput = {
  institution: string;
  classLabel: string;
  academicYear: string;
  subject: string;
  teacher: string;
  period: string;
  students: Student[];
  evaluations: Evaluation[];
  scores: Score[];
  officialAverages?: Record<string, number | null>;
  officialAverageStatus?: string;
};

function value(raw: number | null | undefined) {
  return typeof raw === "number" && Number.isFinite(raw)
    ? raw.toLocaleString("fr-FR", { maximumFractionDigits: 2 })
    : "—";
}
function status(ev: Evaluation) {
  return ev.is_published || ev.publication_status === "published" ? "Publiée" : "Non publiée";
}
function date(raw?: string | null) {
  if (!raw) return "";
  const ymd = raw.slice(0, 10).split("-");
  return ymd.length === 3 ? ymd.reverse().join("/") : raw;
}

/**
 * Génère un vrai PDF A4 paysage à la demande, sans navigateur headless,
 * sans nouvelle écriture et avec au plus quatre évaluations par tableau.
 */
export function buildAdminRegisterPdf(input: AdminRegisterPdfInput): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        layout: "landscape",
        margins: { top: 25, bottom: 15, left: 28, right: 28 },
        bufferPages: false,
        compress: true,
        autoFirstPage: true,
      });
      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.once("end", () => resolve(Buffer.concat(chunks)));
      doc.once("error", reject);
      const schoolFont = path.join(process.cwd(), "public", "card-fonts", "DejaVuSans.ttf");
      doc.registerFont("school", schoolFont);
      doc.font("school");

      const students = [...input.students].sort((a, b) =>
        a.full_name.localeCompare(b.full_name, "fr", { sensitivity: "base", numeric: true }),
      );
      const scoreMap = new Map(input.scores.map((r) => [
        r.evaluation_id + ":" + r.student_id, r.score,
      ]));
      const groups: Evaluation[][] = [];
      const groupSize = 6;
      for (let i = 0; i < input.evaluations.length; i += groupSize) {
        groups.push(input.evaluations.slice(i, i + groupSize));
      }
      if (!groups.length) groups.push([]);

      const margin = 28;
      const tableWidth = doc.page.width - 2 * margin;
      const headerHeight = 36;
      const bottom = doc.page.height - 48;
      let pageNumber = 0;
      let firstPage = true;

      function pageHeading(evaluations: Evaluation[], group: number) {
        pageNumber++;
        const pageWidth = doc.page.width;
        doc.font("school").fillColor("#171717");
        doc.fontSize(12).text(input.institution || "Établissement", margin, 22, {
          width: tableWidth, align: "center", lineBreak: false,
        });
        doc.fontSize(16).text("REGISTRE DES NOTES", margin, 40, {
          width: tableWidth, align: "center", lineBreak: false,
        });
        doc.fontSize(10).text(
          "Année : " + input.academicYear + "    |    Classe : " + input.classLabel +
          "    |    Discipline : " + input.subject,
          margin, 63, { width: tableWidth, align: "center", lineBreak: false },
        );
        doc.fontSize(9).text(
          "Professeur : " + input.teacher + "    |    " + input.period +
          (groups.length > 1 ? "    |    Évaluations " + (group * groupSize + 1) + " à " + (group * groupSize + evaluations.length) : ""),
          margin, 79, { width: tableWidth, align: "center", lineBreak: false },
        );
        doc.moveTo(margin, 96).lineTo(pageWidth - margin, 96).lineWidth(0.8).strokeColor("#555555").stroke();

        doc.fontSize(8).fillColor("#555555").text(
          input.officialAverageStatus === "ok" ? "Bulletin /20 : moyenne officielle de la discipline entière ; — : moyenne non disponible." : "Bulletin /20 : moyenne officielle indisponible ou non applicable ; aucun calcul de remplacement.",
          margin, doc.page.height - 40, { width: tableWidth, align: "center", lineBreak: false },
        );
        doc.fontSize(8).text(
          "Mon Cahier — www.mon-cahier.com — Page " + pageNumber,
          margin, doc.page.height - 27, { width: tableWidth, align: "center", lineBreak: false },
        );
        doc.fillColor("#171717");
      }

      function cell(text: string, x: number, y: number, w: number, h: number, opts?: {
        align?: "left" | "center"; size?: number; bold?: boolean;
      }) {
        doc.font("school").fontSize(opts?.size || 10).fillColor("#171717")
          .text(text, x + 4, y + 3, {
            width: Math.max(1, w - 8),
            height: Math.max(9, h - 4),
            align: opts?.align || "left",
            lineBreak: opts?.align === "left",
            ellipsis: true,
          });
      }

      function grid(evaluations: Evaluation[]) {
        const fixedWidths = [25, 86, 248];
        const averageWidth = 75;
        const noteWidth = (tableWidth - fixedWidths.reduce((a, b) => a + b, 0) - averageWidth) /
          Math.max(evaluations.length, 1);
        const widths = [...fixedWidths, ...evaluations.map(() => noteWidth), averageWidth];
        const names = ["N°", "Matricule", "Nom et prénoms"];
        return { widths, names };
      }

      for (let group = 0; group < groups.length; group++) {
        const evals = groups[group];
        const { widths, names } = grid(evals);
        let rowIndex = 0;
        let needsPage = true;
        while (needsPage) {
          if (!firstPage) doc.addPage();
          firstPage = false;
          pageHeading(evals, group);
          let y = 105;
          let x = margin;
          for (let c = 0; c < widths.length; c++) {
            const w = widths[c];
            doc.save().rect(x, y, w, headerHeight).fillAndStroke("#f3f4f6", "#777777").restore();
            if (c < 3) {
              cell(names[c], x, y + 9, w, headerHeight - 9, { size: 9, align: c < 2 ? "center" : "left" });
            } else if (c === widths.length - 1) {
              doc.save().rect(x, y, w, headerHeight).fillAndStroke("#dbeafe", "#64748b").restore();
              cell("Bulletin", x, y + 3, w, 17, { size: 9, align: "center" });
              cell("Moy. /20", x, y + 17, w, 17, { size: 9, align: "center" });
            } else {
              const ev = evals[c - 3];
              const label = ev.column_label || "Note " + (group * groupSize + c - 2);
              cell(label + " /" + value(ev.scale ?? null), x, y, w, 15, { size: 8, align: "center" });
              cell(date(ev.eval_date), x, y + 11, w, 14, { size: 7.5, align: "center" });
              cell(status(ev), x, y + 22, w, 13, { size: 7, align: "center" });
            }
            x += w;
          }
          y += headerHeight;

          if (students.length === 0) {
            doc.fontSize(10).text("Aucun élève dans la sélection.", margin + 10, y + 20);
            needsPage = false;
          } else {
            while (rowIndex < students.length) {
              const student = students[rowIndex];
              doc.font("school").fontSize(9);
              const nameHeight = doc.heightOfString(student.full_name, {
                width: widths[2] - 10,
              });
              const rh = Math.max(15, Math.ceil(nameHeight + 6));
              if (y + rh > bottom) break;
              let px = margin;
              const vals = [
                String(rowIndex + 1),
                student.matricule || "",
                student.full_name,
                ...evals.map((ev) => value(scoreMap.get(ev.id + ":" + student.id))),
                typeof input.officialAverages?.[student.id] === "number" ? Number(input.officialAverages[student.id]).toLocaleString("fr-FR", {minimumFractionDigits: 2, maximumFractionDigits: 2}) : "—",
              ];
              vals.forEach((v, c) => {
                doc.save()
                  .rect(px, y, widths[c], rh)
                  .fillAndStroke(c === widths.length - 1 ? "#eff6ff" : rowIndex % 2 ? "#f8fafc" : "#ffffff", "#cbd5e1")
                  .restore();
                cell(v, px, y, widths[c], rh, {
                  size: c === 2 ? 9 : 8.5,
                  align: c === 2 ? "left" : "center",
                });
                px += widths[c];
              });
              y += rh;
              rowIndex++;
            }
            needsPage = rowIndex < students.length;
          }
        }
      }
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

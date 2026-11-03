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
        margin: 34,
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
      for (let i = 0; i < input.evaluations.length; i += 4) {
        groups.push(input.evaluations.slice(i, i + 4));
      }
      if (!groups.length) groups.push([]);

      const margin = 34;
      const tableWidth = doc.page.width - 2 * margin;
      const headerHeight = 48;
      const bottom = doc.page.height - 47;
      let firstPage = true;

      function pageHeading(evaluations: Evaluation[], group: number) {
        const pageWidth = doc.page.width;
        doc.font("school").fillColor("#171717");
        doc.fontSize(12).text(input.institution || "Établissement", margin, 31, {
          width: tableWidth, align: "center", lineBreak: false,
        });
        doc.fontSize(16).text("REGISTRE DES NOTES", margin, 53, {
          width: tableWidth, align: "center", lineBreak: false,
        });
        doc.fontSize(10).text(
          "Année : " + input.academicYear + "    |    Classe : " + input.classLabel +
          "    |    Discipline : " + input.subject,
          margin, 83, { width: tableWidth, align: "center", lineBreak: false },
        );
        doc.fontSize(9).text(
          "Professeur : " + input.teacher + "    |    " + input.period +
          (groups.length > 1 ? "    |    Colonnes " + (group * 4 + 1) + " à " + (group * 4 + evaluations.length) : ""),
          margin, 101, { width: tableWidth, align: "center", lineBreak: false },
        );
        doc.moveTo(margin, 119).lineTo(pageWidth - margin, 119).lineWidth(0.8).strokeColor("#555555").stroke();

        doc.fontSize(8).fillColor("#555555").text(
          "Document de consultation — notes saisies, sans modification des résultats",
          margin, doc.page.height - 31, { width: tableWidth, align: "center", lineBreak: false },
        );
        doc.fontSize(8).text(
          "Mon Cahier — www.mon-cahier.com",
          margin, doc.page.height - 18, { width: tableWidth, align: "center", lineBreak: false },
        );
        doc.fillColor("#171717");
      }

      function cell(text: string, x: number, y: number, w: number, h: number, opts?: {
        align?: "left" | "center"; size?: number; bold?: boolean;
      }) {
        doc.font("school").fontSize(opts?.size || 10).fillColor("#171717")
          .text(text, x + 5, y + 5, {
            width: Math.max(1, w - 10),
            height: h - 8,
            align: opts?.align || "left",
            lineBreak: false,
            ellipsis: true,
          });
      }

      function grid(evaluations: Evaluation[]) {
        const fixedWidths = [30, 105, 285];
        const noteWidth = (tableWidth - fixedWidths.reduce((a, b) => a + b, 0)) /
          Math.max(evaluations.length, 1);
        const widths = [...fixedWidths, ...evaluations.map(() => noteWidth)];
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
          let y = 129;
          let x = margin;
          for (let c = 0; c < widths.length; c++) {
            const w = widths[c];
            doc.save().rect(x, y, w, headerHeight).fillAndStroke("#f3f4f6", "#777777").restore();
            if (c < 3) {
              cell(names[c], x, y + 13, w, headerHeight, { size: 9.5, align: c < 2 ? "center" : "left" });
            } else {
              const ev = evals[c - 3];
              const label = ev.column_label || "Note " + (group * 4 + c - 2);
              cell(label, x, y + 2, w, 21, { size: 9.5, align: "center" });
              cell("/" + value(ev.scale ?? null) + " · " + date(ev.eval_date), x, y + 19, w, 18, { size: 8, align: "center" });
              cell(status(ev), x, y + 32, w, 14, { size: 7.5, align: "center" });
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
              doc.fontSize(9.5);
              const nameHeight = doc.heightOfString(student.full_name, {
                width: widths[2] - 10,
              });
              const rh = Math.max(27, Math.ceil(nameHeight + 10));
              if (y + rh > bottom) break;
              let px = margin;
              const vals = [
                String(rowIndex + 1),
                student.matricule || "",
                student.full_name,
                ...evals.map((ev) => value(scoreMap.get(ev.id + ":" + student.id))),
              ];
              vals.forEach((v, c) => {
                doc.save()
                  .rect(px, y, widths[c], rh)
                  .fillAndStroke(rowIndex % 2 ? "#f8fafc" : "#ffffff", "#a4a4a4")
                  .restore();
                cell(v, px, y, widths[c], rh, {
                  size: c === 2 ? 9.5 : 10,
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

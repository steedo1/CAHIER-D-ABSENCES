import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ level: string }> } // Next 15: params est une Promise
) {
  const { level: rawLevel } = await context.params; // on attend la Promise
  const level = decodeURIComponent(rawLevel || "");

  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: me } = await supa
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();

  const inst = me?.institution_id as string | undefined;
  if (!inst) return NextResponse.json({ error: "no_institution" }, { status: 400 });

  const { searchParams } = new URL(req.url);
  const format = (searchParams.get("format") || "csv").toLowerCase();
  const from = searchParams.get("from") || undefined;
  const to = searchParams.get("to") || undefined;

  // marks + joints (élève / classe)
  const { data, error } = await srv
    .from("v_mark_effective_minutes")
    .select(
      `
      mark_id:mark_id,
      status,
      minutes_effective,
      started_at,
      ended_at,
      class_id,
      teacher_id,
      students:student_id(first_name,last_name),
      classes:class_id(label,level,institution_id)
    `
    )
    .eq("classes.institution_id", inst)
    .eq("classes.level", level)
    .order("started_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // filtre période
  const rows = (data ?? []).filter((r: any) => {
    const okFrom = from ? new Date(r.started_at) >= new Date(from) : true;
    const okTo = to ? new Date(r.started_at) <= new Date(to + "T23:59:59Z") : true;
    return okFrom && okTo;
  });

  // Résolution discipline
  const subjCache = new Map<string, string>();
  async function resolveSubject(class_id: string, teacher_id: string, iso: string) {
    const key = `${class_id}|${teacher_id}`;
    if (subjCache.has(key)) return subjCache.get(key)!;

    const d = iso.slice(0, 10);
    const { data: links } = await srv
      .from("class_teachers")
      .select("subject_id,start_date,end_date")
      .eq("institution_id", inst)
      .eq("class_id", class_id)
      .eq("teacher_id", teacher_id);

    const link = (links ?? []).find(
      (l: any) => (!l.start_date || d >= l.start_date) && (!l.end_date || d <= l.end_date)
    );
    if (!link?.subject_id) {
      subjCache.set(key, "—");
      return "—";
    }

    const { data: instSubj } = await srv
      .from("institution_subjects")
      .select("custom_name, subjects:subject_id(name)")
      .eq("institution_id", inst)
      .or(`id.eq.${link.subject_id},subject_id.eq.${link.subject_id}`)
      .limit(1)
      .maybeSingle();

    const name = (instSubj as any)?.custom_name || (instSubj as any)?.subjects?.name || "—";
    subjCache.set(key, name);
    return name;
  }

  // Normalisation
  const items = await Promise.all(
    (rows as any[]).map(async (r) => {
      const start = new Date(r.started_at);
      const end = r.ended_at ? new Date(r.ended_at) : start;
      const full = `${r.students?.first_name ?? ""} ${r.students?.last_name ?? ""}`.trim() || "—";
      const subject = await resolveSubject(r.class_id, r.teacher_id, r.started_at);
      return {
        level: r.classes?.level ?? level,
        class_label: r.classes?.label ?? "—",
        student: full,
        date: start.toISOString().slice(0, 10),
        start: start.toISOString(),
        end: end.toISOString(),
        subject,
        status: r.status,
        minutes: r.minutes_effective as number,
      };
    })
  );

  // Résumé par élève
  const resumeByStudent: Record<string, number> = {};
  for (const it of items) resumeByStudent[it.student] = (resumeByStudent[it.student] || 0) + it.minutes;

  const fileBase = `absences_niveau_${encodeURIComponent(level)}_${from || "debut"}_${to || "fin"}`;

  // ===== CSV =====
  if (format === "csv") {
    const header = ["Niveau", "Classe", "Élève", "Date", "Début", "Fin", "Discipline", "Statut", "Minutes"];
    const lines = [header.join(";")].concat(
      items.map((i) =>
        [
          i.level,
          i.class_label,
          i.student,
          i.date,
          new Date(i.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          new Date(i.end).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          i.subject,
          i.status,
          String(i.minutes),
        ].join(";")
      )
    );
    const csv = lines.join("\n");
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileBase}.csv"`,
      },
    });
  }

  // ===== PDF =====
  const PDFDocument = (await import("pdfkit")).default;

  const doc = new PDFDocument({ size: "A4", margin: 40 }) as any;
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    doc.on("end", resolve);
    doc.on("error", reject);

    doc.fontSize(16).text(`Absences — Niveau ${level}`, { align: "center" });
    doc.moveDown(0.4);
    doc.fontSize(10).text(`Période : ${from || "—"} → ${to || "—"}`);
    doc.moveDown(0.8);

    // Résumé par élève
    doc.fontSize(12).text("Résumé par élève", { underline: true });
    doc.moveDown(0.4);

    const rCol = [40, 360];
    doc.fontSize(10).text("Élève", rCol[0], doc.y, { continued: true });
    doc.text("Minutes", rCol[1]);
    doc.moveTo(40, doc.y).lineTo(550, doc.y).stroke();

    let total = 0;
    Object.entries(resumeByStudent)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .forEach(([student, min]) => {
        total += min;
        doc.text(student, rCol[0], doc.y, { continued: true });
        doc.text(`${min} (${Math.floor(min / 60)}h ${min % 60}m)`, rCol[1]);
      });

    doc.moveDown(0.4);
    doc
      .fontSize(10)
      .text(`Total minutes : ${total}  (= ${Math.floor(total / 60)} h ${total % 60} min)`, { align: "right" });
    doc.moveDown(0.8);

    // Détail
    doc.fontSize(12).text("Détail", { underline: true });
    doc.moveDown(0.4);

    const col = [40, 95, 140, 200, 290, 420, 500];
    const head = ["Date", "Début", "Fin", "Classe", "Élève", "Discipline", "Min"];
    doc.fontSize(9);
    head.forEach((h: string, i: number) => doc.text(h, col[i], doc.y, { continued: i < head.length - 1 }));
    doc.moveDown(0.3);
    doc.moveTo(40, doc.y).lineTo(550, doc.y).stroke();

    items.forEach((i) => {
      const row = [
        i.date,
        new Date(i.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        new Date(i.end).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        i.class_label,
        i.student,
        i.subject,
        String(i.minutes),
      ];
      row.forEach((v, idx) =>
        doc.text(v, col[idx], doc.y, {
          continued: idx < row.length - 1,
          width: idx === 4 || idx === 5 ? 110 : undefined,
        })
      );
      doc.moveDown(0.15);
    });

    doc.end();
  });

  const pdfBuffer = Buffer.concat(chunks);
  const body = new Uint8Array(pdfBuffer);

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileBase}.pdf"`,
    },
  });
}

import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: { id: string } }) {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();
  const class_id = ctx.params.id;

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
    .eq("class_id", class_id)
    .order("started_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const rows = (data ?? []).filter((r: any) => {
    const okFrom = from ? new Date(r.started_at) >= new Date(from) : true;
    const okTo = to ? new Date(r.started_at) <= new Date(to + "T23:59:59Z") : true;
    return okFrom && okTo;
  });

  // Discipline
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
      subjCache.set(key, "â€”");
      return "â€”";
    }

    const { data: instSubj } = await srv
      .from("institution_subjects")
      .select("custom_name, subjects:subject_id(name)")
      .eq("institution_id", inst)
      .or(`id.eq.${link.subject_id},subject_id.eq.${link.subject_id}`)
      .limit(1)
      .maybeSingle();

    const name = (instSubj as any)?.custom_name || (instSubj as any)?.subjects?.name || "â€”";
    subjCache.set(key, name);
    return name;
  }

  const items = await Promise.all(
    (rows as any[]).map(async (r) => {
      const start = new Date(r.started_at);
      const end = r.ended_at ? new Date(r.ended_at) : start;
      const full = `${r.students?.first_name ?? ""} ${r.students?.last_name ?? ""}`.trim() || "â€”";
      const subject = await resolveSubject(r.class_id, r.teacher_id, r.started_at);
      return {
        level: r.classes?.level ?? "â€”",
        class_label: r.classes?.label ?? "â€”",
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

  const resumeByStudent: Record<string, number> = {};
  let classLabel = items[0]?.class_label || "Classe";
  for (const it of items) resumeByStudent[it.student] = (resumeByStudent[it.student] || 0) + it.minutes;

  const fileBase = `absences_classe_${encodeURIComponent(class_id)}_${from || "debut"}_${to || "fin"}`;

  // ===== CSV =====
  if (format === "csv") {
    const header = ["Classe", "Ã‰lÃ¨ve", "Date", "DÃ©but", "Fin", "Discipline", "Statut", "Minutes"];
    const lines = [header.join(";")].concat(
      items.map((i) =>
        [
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

    doc.fontSize(16).text(`Absences â€” ${classLabel}`, { align: "center" });
    doc.moveDown(0.4);
    doc.fontSize(10).text(`PÃ©riode : ${from || "â€”"} â†’ ${to || "â€”"}`);
    doc.moveDown(0.8);

    // RÃ©sumÃ©
    doc.fontSize(12).text("RÃ©sumÃ© par Ã©lÃ¨ve", { underline: true });
    doc.moveDown(0.4);

    const rCol = [40, 360];
    doc.fontSize(10).text("Ã‰lÃ¨ve", rCol[0], doc.y, { continued: true });
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

    // DÃ©tail
    doc.fontSize(12).text("DÃ©tail", { underline: true });
    doc.moveDown(0.4);

    const col = [40, 95, 140, 270, 420, 500];
    const head = ["Date", "DÃ©but", "Fin", "Ã‰lÃ¨ve", "Discipline", "Min"];
    doc.fontSize(9);
    head.forEach((h: string, i: number) => doc.text(h, col[i], doc.y, { continued: i < head.length - 1 }));
    doc.moveDown(0.3);
    doc.moveTo(40, doc.y).lineTo(550, doc.y).stroke();

    items.forEach((i) => {
      const row = [
        i.date,
        new Date(i.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        new Date(i.end).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        i.student,
        i.subject,
        String(i.minutes),
      ];
      row.forEach((v, idx) =>
        doc.text(v, col[idx], doc.y, {
          continued: idx < row.length - 1,
          width: idx === 3 || idx === 4 ? 130 : undefined,
        })
      );
      doc.moveDown(0.15);
    });

    doc.end();
  });

  const pdfBuffer = Buffer.concat(chunks);
  const body = new Uint8Array(pdfBuffer); // âœ… BodyInit compatible

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileBase}.pdf"`,
    },
  });
}

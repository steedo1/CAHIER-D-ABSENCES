import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Même approche : students/classes peuvent être objet ou tableau. */
type RawRow = {
  id: string;
  student_id: string;
  status: "absent" | "late" | string;
  started_at: string;
  expected_minutes: number | null;
  minutes: number | null;
  minutes_late: number | null;
  teacher_id: string | null;
  class_id: string;
  students?:
    | { first_name: string | null; last_name: string | null }
    | { first_name: string | null; last_name: string | null }[]
    | null;
  classes?:
    | { label: string | null; level: string | null; institution_id: string }
    | { label: string | null; level: string | null; institution_id: string }[]
    | null;
};

function fmtDate(dISO: string) {
  return dISO.slice(0, 10);
}
function fmtTime(dISO: string) {
  return new Date(dISO).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
function addMinutes(dISO: string, mins: number) {
  const d = new Date(dISO);
  d.setMinutes(d.getMinutes() + mins);
  return d.toISOString();
}
function fmtHM(m: number) {
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
function excelText(s: string) {
  const v = String(s ?? "");
  const danger = /^[-+=@].*/.test(v);
  return "'" + (danger ? " " + v : v);
}
function csvEscape(s: string) {
  const v = String(s ?? "");
  return /[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
function pickStudent(
  s: RawRow["students"]
): { first_name: string | null; last_name: string | null } | null {
  if (!s) return null;
  return Array.isArray(s) ? s[0] ?? null : s;
}
function pickClass(
  c: RawRow["classes"]
): { label: string | null; level: string | null; institution_id: string } | null {
  if (!c) return null;
  return Array.isArray(c) ? c[0] ?? null : c;
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id: class_id } = await context.params;

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
  const group = (searchParams.get("group") || "").toLowerCase(); // "student" ou vide

  let q = srv
    .from("marks_expanded")
    .select(
      `
      id,
      student_id,
      status,
      started_at,
      expected_minutes,
      minutes,
      minutes_late,
      teacher_id,
      class_id,
      students:student_id(first_name,last_name),
      classes:class_id(label,level,institution_id)
    `
    )
    .eq("classes.institution_id", inst)
    .eq("class_id", class_id)
    .in("status", ["absent", "late"]);

  if (from) q = q.gte("started_at", `${from}T00:00:00Z`);
  if (to) q = q.lte("started_at", `${to}T23:59:59Z`);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const rows = (data ?? []) as RawRow[];

  /* ============================
     MODE RÉSUMÉ PAR ÉLÈVE
  ============================ */
  if (group === "student") {
    const byId = new Map<string, { student_id: string; student: string; class_label: string; minutes: number }>();
    let classLabel = "Classe";

    for (const r of rows) {
      const st = pickStudent(r.students);
      const cl = pickClass(r.classes);
      if (cl?.label) classLabel = cl.label;

      let m = 0;
      if (r.status === "late") m = Number(r.minutes_late ?? 0);
      else m = Number(r.minutes ?? 0) || Number(r.expected_minutes ?? 0);

      const student = `${st?.first_name ?? ""} ${st?.last_name ?? ""}`.trim() || "—";

      const cur = byId.get(r.student_id);
      if (cur) cur.minutes += m;
      else byId.set(r.student_id, { student_id: r.student_id, student, class_label: cl?.label ?? classLabel, minutes: m });
    }

    const list = Array.from(byId.values()).sort((a, b) =>
      a.student.localeCompare(b.student, undefined, { sensitivity: "base" })
    );

    const fileBase = `absences_classe_${encodeURIComponent(class_id)}_${from || "debut"}_${to || "fin"}_resume`;
    const header = ["Classe", "Élève", "Total minutes", "Total (h m)"];
    const lines = [header.join(";")].concat(
      list.map((i) =>
        [csvEscape(excelText(i.class_label)), csvEscape(i.student), String(i.minutes), csvEscape(fmtHM(i.minutes))].join(
          ";"
        )
      )
    );
    const csv = "\ufeff" + lines.join("\r\n");
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileBase}.csv"`,
      },
    });
  }

  /* ============================
     MODE DÉTAILLÉ (CSV)
  ============================ */
  const items = rows.map((r) => {
    const st = pickStudent(r.students);
    const cl = pickClass(r.classes);

    const startISO = r.started_at;
    const endISO =
      r.expected_minutes && r.expected_minutes > 0
        ? addMinutes(startISO, r.expected_minutes)
        : startISO;

    let minutes = 0;
    if (r.status === "late") minutes = Number(r.minutes_late ?? 0);
    else minutes = Number(r.minutes ?? 0) || Number(r.expected_minutes ?? 0);

    const fullName = `${st?.first_name ?? ""} ${st?.last_name ?? ""}`.trim() || "—";

    return {
      class_label: cl?.label ?? "—",
      student: fullName,
      date: fmtDate(startISO),
      startISO,
      endISO,
      subject: "—",
      status: r.status,
      minutes,
    };
  });

  items.sort((a, b) =>
    a.student.localeCompare(b.student, undefined, { sensitivity: "base" }) ||
    a.startISO.localeCompare(b.startISO)
  );

  const fileBase = `absences_classe_${encodeURIComponent(class_id)}_${from || "debut"}_${to || "fin"}`;

  if (format === "csv") {
    const header = ["Classe", "Élève", "Date", "Début", "Fin", "Discipline", "Statut", "Minutes"];
    const lines = [header.join(";")].concat(
      items.map((i) =>
        [
          csvEscape(excelText(i.class_label)),
          csvEscape(i.student),
          csvEscape(i.date),
          csvEscape(fmtTime(i.startISO)),
          csvEscape(fmtTime(i.endISO)),
          csvEscape(i.subject),
          csvEscape(i.status),
          String(i.minutes),
        ].join(";")
      )
    );
    const csv = "\ufeff" + lines.join("\r\n");
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileBase}.csv"`,
      },
    });
  }

  return NextResponse.json({ error: "unsupported_format" }, { status: 400 });
}

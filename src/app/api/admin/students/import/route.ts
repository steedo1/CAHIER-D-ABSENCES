import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

/** ---------- CSV utils ---------- */
function stripAccents(s: string) {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}
function normHeader(s: string) {
  return stripAccents(String(s).toLowerCase()).replace(/\s+/g, " ").trim();
}

/** Détection du séparateur + guillemets */
function parseCSV(raw: string) {
  const firstNonEmpty = (raw.split(/\r?\n/).find(l => l.trim().length > 0) ?? "");
  const sep =
    firstNonEmpty.includes("\t")
      ? "\t"
      : (firstNonEmpty.split(";").length > firstNonEmpty.split(",").length ? ";" : ",");

  const rows: string[][] = [];
  let i = 0, f = "", inQ = false, line: string[] = [];
  const s = raw.replace(/\r\n/g, "\n");
  const pushField = () => { line.push(f); f = ""; };
  const pushLine  = () => { rows.push(line); line = []; };

  while (i < s.length) {
    const c = s[i];
    if (c === '"') {
      if (inQ && s[i + 1] === '"') { f += '"'; i += 2; continue; }
      inQ = !inQ; i++; continue;
    }
    if (!inQ && c === sep) { pushField(); i++; continue; }
    if (!inQ && c === "\n") { pushField(); pushLine(); i++; continue; }
    f += c; i++;
  }
  pushField();
  if (line.length > 1 || (line[0] ?? "").trim() !== "") pushLine();

  return rows.filter(r => r.some(c => String(c).trim() !== ""));
}

/** "NOM Prenoms" → { last_name, first_name } */
function splitFullName(v: string) {
  const s = (v || "").replace(/\s+/g, " ").trim();
  if (!s) return { last_name: "", first_name: "" };
  // "NOM, Prenoms"
  const comma = s.split(",").map(x => x.trim());
  if (comma.length >= 2) return { last_name: comma[0], first_name: comma.slice(1).join(" ") };
  const parts = s.split(" ");
  return { last_name: parts[0] || "", first_name: parts.slice(1).join(" ") || "" };
}

/** Parsing flexible des élèves */
function parseCsvStudentsFlexible(raw: string) {
  const rows = parseCSV(raw);
  if (!rows.length) return [];

  const Hraw = rows[0];
  const H = Hraw.map(normHeader).map(h => h.replace(/[._-]/g, " ").replace(/\s+/g, " ").trim());
  const hCompact = (h: string) => h.replace(/[ .]/g, "");

  // Expressions ANCRÉES pour éviter "no" ≠ "nom"
  const idx = {
    numero:   H.findIndex(h => /^(n°|nº|no|numero|num|#)$/i.test(hCompact(h))),
    matric:   H.findIndex(h => /^(matricule|matr|code|id|identifiant|matric)$/i.test(hCompact(h))),
    nom:      H.findIndex(h => /^(nom|last|surname)$/i.test(hCompact(h))),
    prenom:   H.findIndex(h => /^(prenom|prenoms|first|given)$/i.test(hCompact(h))),
    fullname: H.findIndex(h => /^(nomcomplet|nom et prenoms?|fullname|name|nomprenom?s?)$/i.test(hCompact(h))),
  };

  const body = rows.slice(1).map((cols, i) => {
    const cell = (k: number) => (k >= 0 ? String(cols[k] ?? "").trim() : "");

    let last_name = "", first_name = "";
    if (idx.nom >= 0 && idx.prenom >= 0) {
      last_name = cell(idx.nom);
      first_name = cell(idx.prenom);
    } else if (idx.fullname >= 0) {
      const s = splitFullName(cell(idx.fullname));
      last_name = s.last_name; first_name = s.first_name;
    }

    return {
      _row: i, // ordre d’origine pour garder l’ordre du fichier
      numero:    cell(idx.numero),
      matricule: cell(idx.matric) || null,
      last_name, first_name,
    };
  });

  // On garde l’ordre d’origine, on filtre les lignes vides
  return body.filter(r => (r.last_name || r.first_name || r.matricule));
}

/** ---------- Route ---------- */
export async function POST(req: Request) {
  const supa = await getSupabaseServerClient();
  const srv  = getSupabaseServiceClient();

  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: me } = await supa
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();

  const inst = (me?.institution_id ?? null) as string | null;

  const body = await req.json().catch(() => ({}));
  const action   = String(body?.action || "");
  const csv      = String(body?.csv || "");
  const class_id = String(body?.class_id || "");

  const parsed = parseCsvStudentsFlexible(csv);

  if (action === "preview") {
    const preview = parsed.slice(0, 500).map(r => ({
      numero: r.numero || null,
      matricule: r.matricule || null,
      last_name: r.last_name || "",
      first_name: r.first_name || "",
      full_name: [r.last_name, r.first_name].filter(Boolean).join(" "),
    }));
    return NextResponse.json({ preview });
  }

  if (action === "commit") {
    if (!inst) return NextResponse.json({ error: "no_institution" }, { status: 400 });
    if (!class_id) return NextResponse.json({ error: "class_id_required" }, { status: 400 });

    // Classe dans mon établissement ?
    const { data: cls } = await srv
      .from("classes")
      .select("id,institution_id")
      .eq("id", class_id)
      .maybeSingle();

    if (!cls || (cls as any).institution_id !== inst) {
      return NextResponse.json({ error: "invalid_class" }, { status: 400 });
    }

    // Insert élèves
    const students = parsed.map(r => ({
      institution_id: inst,
      first_name: r.first_name,
      last_name:  r.last_name,
      matricule:  r.matricule,
    }));

    const { data: created, error: e1 } = await srv
      .from("students")
      .insert(students)
      .select("id");

    if (e1) return NextResponse.json({ error: e1.message }, { status: 400 });

    // Inscriptions : respecter NOT NULL sur start_date (et institution_id si présent)
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const enrollRows = (created || []).map(s => ({
      class_id,
      student_id: s.id,
      institution_id: inst, // si la colonne existe
      start_date: today,    // satisfait NOT NULL
      end_date: null,       // si la colonne existe
    }));

    if (enrollRows.length) {
      const { error: e2 } = await srv
        .from("class_enrollments")
        // nécessite une contrainte UNIQUE (class_id, student_id)
        .upsert(enrollRows, { onConflict: "class_id,student_id" });

      if (e2) return NextResponse.json({ error: e2.message }, { status: 400 });
    }

    return NextResponse.json({ inserted: created?.length || 0 });
  }

  return NextResponse.json({ error: "bad_action" }, { status: 400 });
}

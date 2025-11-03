import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

/* ───────── CSV utils ───────── */
function stripAccents(s: string) {
  return (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
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
      _row: i,
      numero:    cell(idx.numero),
      matricule: cell(idx.matric) || null,
      last_name, first_name,
    };
  });

  return body.filter(r => (r.last_name || r.first_name || r.matricule));
}

/* ───────── Route ───────── */
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

  if (action !== "commit") {
    return NextResponse.json({ error: "bad_action" }, { status: 400 });
  }

  /* ── commit ── */
  if (!inst)     return NextResponse.json({ error: "no_institution" }, { status: 400 });
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

  // 1) Matricules (distincts, non vides)
  const wantedMatr = Array.from(new Set(parsed.map(r => (r.matricule ?? "").trim()).filter(Boolean)));

  // 2) Élèves existants par matricule
  let existingByMat: Record<string, { id: string; first_name: string | null; last_name: string | null }> = {};
  if (wantedMatr.length) {
    const { data: existing, error: exErr } = await srv
      .from("students")
      .select("id, matricule, first_name, last_name")
      .eq("institution_id", inst)
      .in("matricule", wantedMatr);
    if (exErr) return NextResponse.json({ error: exErr.message }, { status: 400 });

    for (const s of (existing ?? [])) {
      existingByMat[(s as any).matricule] = {
        id: (s as any).id,
        first_name: (s as any).first_name,
        last_name:  (s as any).last_name
      };
    }
  }

  // 3) Créer les élèves manquants
  const toInsert = parsed
    .filter(r => (r.matricule ?? "").trim() && !existingByMat[(r.matricule as string)])
    .map(r => ({
      institution_id: inst,
      first_name: r.first_name || null,
      last_name:  r.last_name  || null,
      matricule:  r.matricule!.trim(),
    }));

  let createdCount = 0;
  if (toInsert.length) {
    const { data: createdRows, error: e1 } = await srv
      .from("students")
      .insert(toInsert)
      .select("id, matricule");
    if (e1) return NextResponse.json({ error: e1.message }, { status: 400 });

    createdCount = (createdRows ?? []).length;
    for (const s of (createdRows ?? [])) {
      existingByMat[(s as any).matricule] = { id: (s as any).id, first_name: null, last_name: null };
    }
  }

  // 4) Mettre à jour nom/prénom des existants si différents
  const toUpdate = parsed
    .filter(r => (r.matricule ?? "").trim() && existingByMat[r.matricule as string])
    .map(r => {
      const cur = existingByMat[r.matricule as string];
      const patch: any = {};
      if (r.first_name && r.first_name !== (cur.first_name ?? "")) patch.first_name = r.first_name;
      if (r.last_name  && r.last_name  !== (cur.last_name  ?? "")) patch.last_name  = r.last_name;
      return { id: cur.id, patch };
    })
    .filter(x => Object.keys(x.patch).length > 0);

  let updatedNames = 0;
  for (const u of toUpdate) {
    const { error } = await srv.from("students").update(u.patch).eq("id", u.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    updatedNames++;
  }

  // 5) IDs de tous les élèves importés
  const allStudentIds: string[] = parsed
    .map(r => r.matricule)
    .filter((m): m is string => !!m && !!existingByMat[m])
    .map(m => existingByMat[m].id);

  if (!allStudentIds.length) {
    return NextResponse.json({
      inserted: createdCount,
      updated_names: updatedNames,
      closed_old_enrollments: 0,
      reactivated_in_target: 0,
      inserted_in_target: 0
    });
  }

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // 6) Clôturer TOUTE inscription active du même élève dans une AUTRE classe de la même institution
  //    (on garde l'historique -> end_date = today; on NE SUPPRIME PAS)
  let closedOld = 0;
  {
    const { data, error } = await srv
      .from("class_enrollments")
      .update({ end_date: today })
      .in("student_id", allStudentIds)
      .neq("class_id", class_id)
      .eq("institution_id", inst)
      .is("end_date", null)
      .select("id"); // pour compter
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    closedOld = (data ?? []).length;
  }

  // 7) Réactiver si une inscription cible existe déjà (on remet end_date=null)
  let reactivated = 0;
  {
    const { data, error } = await srv
      .from("class_enrollments")
      .update({ end_date: null })
      .in("student_id", allStudentIds)
      .eq("class_id", class_id)
      .eq("institution_id", inst)
      .select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    reactivated = (data ?? []).length;
  }

  // 8) Insérer celles qui n’existent pas encore dans la classe cible (sans écraser les existantes)
  //    NB: on met start_date = today à la création; si la ligne existait, on ne la remplace pas.
  let insertedTarget = 0;
  {
    const enrollRows = allStudentIds.map(sid => ({
      class_id,
      student_id: sid,
      institution_id: inst,
      start_date: today,
      end_date: null,
    }));

    const { data, error } = await srv
      .from("class_enrollments")
      .upsert(enrollRows, { onConflict: "class_id,student_id", ignoreDuplicates: true })
      .select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    insertedTarget = (data ?? []).length;
  }

  // (Optionnel) logs utiles côté serveur
  try {
    console.log("[students/import] commit",
      { class_id, createdCount, updatedNames, closedOld, reactivated, insertedTarget });
  } catch {}

  return NextResponse.json({
    inserted: createdCount,
    updated_names: updatedNames,
    closed_old_enrollments: closedOld,
    reactivated_in_target: reactivated,
    inserted_in_target: insertedTarget
  });
}

// src/app/api/admin/students/import/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ───────── CSV utils ───────── */
function stripAccents(s: string) {
  return (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
function normHeader(s: string) {
  return stripAccents(String(s).toLowerCase()).replace(/\s+/g, " ").trim();
}
function normSpaces(s: string) {
  return String(s || "").replace(/\s+/g, " ").trim();
}
function makeFullNameKey(fullName: string) {
  return stripAccents(normSpaces(fullName)).toLowerCase();
}

/** Détection du séparateur + guillemets */
function parseCSV(raw: string) {
  const firstNonEmpty =
    raw.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
  const sep =
    firstNonEmpty.includes("\t")
      ? "\t"
      : firstNonEmpty.split(";").length > firstNonEmpty.split(",").length
      ? ";"
      : ",";

  const rows: string[][] = [];
  let i = 0,
    f = "",
    inQ = false,
    line: string[] = [];
  const s = raw.replace(/\r\n/g, "\n");
  const pushField = () => {
    line.push(f);
    f = "";
  };
  const pushLine = () => {
    rows.push(line);
    line = [];
  };

  while (i < s.length) {
    const c = s[i];
    if (c === '"') {
      if (inQ && s[i + 1] === '"') {
        f += '"';
        i += 2;
        continue;
      }
      inQ = !inQ;
      i++;
      continue;
    }
    if (!inQ && c === sep) {
      pushField();
      i++;
      continue;
    }
    if (!inQ && c === "\n") {
      pushField();
      pushLine();
      i++;
      continue;
    }
    f += c;
    i++;
  }
  pushField();
  if (line.length > 1 || (line[0] ?? "").trim() !== "") pushLine();

  return rows.filter((r) => r.some((c) => String(c).trim() !== ""));
}

/** "NOM Prenoms" → { last_name, first_name } */
function splitFullName(v: string) {
  const s = (v || "").replace(/\s+/g, " ").trim();
  if (!s) return { last_name: "", first_name: "" };
  const comma = s.split(",").map((x) => x.trim());
  if (comma.length >= 2) {
    return { last_name: comma[0], first_name: comma.slice(1).join(" ") };
  }
  const parts = s.split(" ");
  return {
    last_name: parts[0] || "",
    first_name: parts.slice(1).join(" ") || "",
  };
}

/* ───────── Helpers de parsing ───────── */
function parseBoolCell(raw: string): boolean | null {
  const s = stripAccents(raw || "").toLowerCase().trim();
  if (!s) return null;
  if (["oui", "yes", "y", "1", "true", "vrai", "x"].includes(s)) return true;
  if (["non", "no", "0", "false", "faux"].includes(s)) return false;
  return null;
}

function parseGenderCell(raw: string): string | null {
  const s = stripAccents(raw || "").toLowerCase().trim();
  if (!s) return null;
  if (s.startsWith("m")) return "M";
  if (s.startsWith("f")) return "F";
  return raw.trim() || null;
}

function parseBirthdateCell(raw: string): string | null {
  const v = (raw || "").trim();
  if (!v) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;

  const m = v.replace(/\./g, "/").match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) {
    const d = m[1].padStart(2, "0");
    const mo = m[2].padStart(2, "0");
    const y = m[3];
    return `${y}-${mo}-${d}`;
  }

  return null;
}

function parsePhotoCell(raw: string): string | null {
  const v = String(raw || "").trim();
  if (!v) return null;
  // on accepte URL http(s) ou chemin storage déjà généré
  return v;
}

/* ───────── Type des lignes CSV parsées ───────── */
type ParsedStudentRow = {
  _row: number;
  numero: string;
  matricule: string | null;
  last_name: string;
  first_name: string;
  full_name: string; // calculé
  full_name_key: string; // calculé
  gender: string | null;
  birthdate: string | null;
  birth_place: string | null;
  nationality: string | null;
  regime: string | null;
  is_repeater: boolean | null;
  is_boarder: boolean | null;
  is_affecte: boolean | null;
  photo_url: string | null;
};

/** Parsing flexible des élèves (+ identité + photo_url) */
function parseCsvStudentsFlexible(raw: string): ParsedStudentRow[] {
  const rows = parseCSV(raw);
  if (!rows.length) return [];

  const Hraw = rows[0];
  const H = Hraw.map(normHeader).map((h) =>
    h.replace(/[._-]/g, " ").replace(/\s+/g, " ").trim()
  );
  const hCompact = (h: string) => h.replace(/[ .]/g, "");

  const idx = {
    numero: H.findIndex((h) => /^(n°|nº|no|numero|num|#)$/i.test(hCompact(h))),
    matric: H.findIndex((h) =>
      /^(matricule|matr|code|id|identifiant|matric)$/i.test(hCompact(h))
    ),
    nom: H.findIndex((h) => /^(nom|last|surname)$/i.test(hCompact(h))),
    prenom: H.findIndex((h) => /^(prenom|prenoms|first|given)$/i.test(hCompact(h))),
    fullname: H.findIndex((h) =>
      /^(nomcomplet|nometprenoms?|fullname|name|nomprenom?s?)$/i.test(hCompact(h))
    ),
    gender: H.findIndex((h) => /^(sexe|sex|genre|gender)$/i.test(hCompact(h))),
    birthdate: H.findIndex((h) =>
      /^(datenaissance|datedenaissance|birthdate|dateofbirth|dob)$/i.test(hCompact(h))
    ),
    birth_place: H.findIndex((h) =>
      /^(lieudenaissance|lieunaissance|birthplace|placeofbirth)$/i.test(hCompact(h))
    ),
    nationality: H.findIndex((h) => /^(nationalite|nationality)$/i.test(hCompact(h))),
    regime: H.findIndex((h) => /^(regime|statut|status)$/i.test(hCompact(h))),
    is_repeater: H.findIndex((h) =>
      /^(redoublant(e)?|redoublant|repeater|repeat)$/i.test(hCompact(h))
    ),
    is_boarder: H.findIndex((h) => /^(interne|boarding|boarder)$/i.test(hCompact(h))),
    is_affecte: H.findIndex((h) => /^(affecte(e)?|affectation)$/i.test(hCompact(h))),
    photo: H.findIndex((h) =>
      /^(photo|photourl|photo_url|image|imageurl|image_url|avatar|avatarurl|avatar_url|profil|profile)$/i.test(
        hCompact(h)
      )
    ),
  };

  const body = rows.slice(1).map((cols, i) => {
    const cell = (k: number) => (k >= 0 ? String(cols[k] ?? "").trim() : "");

    let last_name = "";
    let first_name = "";

    if (idx.nom >= 0 && idx.prenom >= 0) {
      last_name = cell(idx.nom);
      first_name = cell(idx.prenom);
    } else if (idx.fullname >= 0) {
      const s = splitFullName(cell(idx.fullname));
      last_name = s.last_name;
      first_name = s.first_name;
    }

    const full_name = normSpaces([last_name, first_name].filter(Boolean).join(" "));
    const full_name_key = makeFullNameKey(full_name);

    const gender = idx.gender >= 0 ? parseGenderCell(cell(idx.gender)) : null;
    const birthdate = idx.birthdate >= 0 ? parseBirthdateCell(cell(idx.birthdate)) : null;
    const birth_place = idx.birth_place >= 0 ? (cell(idx.birth_place) || null) : null;
    const nationality = idx.nationality >= 0 ? (cell(idx.nationality) || null) : null;
    const regime = idx.regime >= 0 ? (cell(idx.regime) || null) : null;

    const is_repeater = idx.is_repeater >= 0 ? parseBoolCell(cell(idx.is_repeater)) : null;
    const is_boarder = idx.is_boarder >= 0 ? parseBoolCell(cell(idx.is_boarder)) : null;
    const is_affecte = idx.is_affecte >= 0 ? parseBoolCell(cell(idx.is_affecte)) : null;

    const photo_url = idx.photo >= 0 ? parsePhotoCell(cell(idx.photo)) : null;

    return {
      _row: i,
      numero: cell(idx.numero),
      matricule: cell(idx.matric) || null,
      last_name,
      first_name,
      full_name,
      full_name_key,
      gender,
      birthdate,
      birth_place,
      nationality,
      regime,
      is_repeater,
      is_boarder,
      is_affecte,
      photo_url,
    };
  });

  return body.filter((r) => r.last_name || r.first_name || r.matricule || r.photo_url);
}

/* ───────── Guard admin ───────── */
type GuardOk = { userId: string; instId: string };
type GuardErr = { error: "unauthorized" | "no_institution" | "forbidden" };

async function guardAdmin(
  supa: SupabaseClient,
  srv: SupabaseClient
): Promise<GuardOk | GuardErr> {
  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) return { error: "unauthorized" };

  const { data: me } = await supa
    .from("profiles")
    .select("id, role, institution_id")
    .eq("id", user.id)
    .maybeSingle();

  let instId: string | null = (me?.institution_id as string) || null;
  const roleProfile = String(me?.role || "");

  let roleFromUR: string | null = null;
  if (!instId || !["admin", "super_admin"].includes(roleProfile)) {
    const { data: urRows } = await srv
      .from("user_roles")
      .select("role, institution_id")
      .eq("profile_id", user.id);

    const adminRow = (urRows || []).find((r) =>
      ["admin", "super_admin"].includes(String(r.role || ""))
    );
    if (adminRow) {
      roleFromUR = String(adminRow.role);
      if (!instId && adminRow.institution_id) instId = String(adminRow.institution_id);
    }
  }

  const isAdmin =
    ["admin", "super_admin"].includes(roleProfile) ||
    ["admin", "super_admin"].includes(String(roleFromUR || ""));

  if (!instId) return { error: "no_institution" };
  if (!isAdmin) return { error: "forbidden" };

  return { userId: user.id, instId };
}

/* ───────── Route ───────── */
export async function POST(req: NextRequest) {
  const supa = (await getSupabaseServerClient()) as unknown as SupabaseClient;
  const srv = getSupabaseServiceClient() as unknown as SupabaseClient;

  const g = await guardAdmin(supa, srv);
  if ("error" in g) {
    const status = g.error === "unauthorized" ? 401 : 403;
    return NextResponse.json({ error: g.error }, { status });
  }

  const inst = g.instId;

  const body = await req.json().catch(() => ({}));
  const action = String(body?.action || "");
  const csv = String(body?.csv || "");
  const class_id = String(body?.class_id || "");

  const parsed = parseCsvStudentsFlexible(csv);

  if (action === "preview") {
    const preview = parsed.slice(0, 500).map((r) => ({
      numero: r.numero || null,
      matricule: r.matricule || null,
      last_name: r.last_name || "",
      first_name: r.first_name || "",
      full_name: r.full_name || "",
      gender: r.gender || null,
      birthdate: r.birthdate || null,
      birth_place: r.birth_place || null,
      nationality: r.nationality || null,
      regime: r.regime || null,
      is_repeater: r.is_repeater ?? null,
      is_boarder: r.is_boarder ?? null,
      is_affecte: r.is_affecte ?? null,
      photo_url: r.photo_url ?? null,
    }));
    return NextResponse.json({ preview });
  }

  if (action !== "commit") {
    return NextResponse.json({ error: "bad_action" }, { status: 400 });
  }

  /* ── commit ── */
  if (!class_id) {
    return NextResponse.json({ error: "class_id_required" }, { status: 400 });
  }

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
  const wantedMatr = Array.from(
    new Set(parsed.map((r) => (r.matricule ?? "").trim()).filter(Boolean))
  );

  // 1bis) full_name_key (distincts) pour rows SANS matricule (photo import ou correction)
  const wantedNameKeys = Array.from(
    new Set(
      parsed
        .filter((r) => !(r.matricule ?? "").trim())
        .map((r) => r.full_name_key)
        .filter(Boolean)
    )
  );

  type ExistingStudent = {
    id: string;
    matricule: string | null;
    full_name_key: string | null;
    first_name: string | null;
    last_name: string | null;
    gender: string | null;
    birthdate: string | null;
    birth_place: string | null;
    nationality: string | null;
    regime: string | null;
    is_repeater: boolean | null;
    is_boarder: boolean | null;
    is_affecte: boolean | null;
    photo_url: string | null;
  };

  // 2) Élèves existants par matricule
  const existingByMat: Record<string, ExistingStudent> = {};

  if (wantedMatr.length) {
    const { data: existing, error: exErr } = await srv
      .from("students")
      .select(
        "id, matricule, full_name_key, first_name, last_name, gender, birthdate, birth_place, nationality, regime, is_repeater, is_boarder, is_affecte, photo_url"
      )
      .eq("institution_id", inst)
      .in("matricule", wantedMatr);

    if (exErr) return NextResponse.json({ error: exErr.message }, { status: 400 });

    for (const s of existing ?? []) {
      const row = s as any;
      const m = String(row.matricule || "").trim();
      if (!m) continue;
      existingByMat[m] = {
        id: String(row.id),
        matricule: row.matricule ?? null,
        full_name_key: row.full_name_key ?? null,
        first_name: row.first_name ?? null,
        last_name: row.last_name ?? null,
        gender: row.gender ?? null,
        birthdate: row.birthdate ?? null,
        birth_place: row.birth_place ?? null,
        nationality: row.nationality ?? null,
        regime: row.regime ?? null,
        is_repeater: typeof row.is_repeater === "boolean" ? row.is_repeater : null,
        is_boarder: typeof row.is_boarder === "boolean" ? row.is_boarder : null,
        is_affecte: typeof row.is_affecte === "boolean" ? row.is_affecte : null,
        photo_url: row.photo_url ?? null,
      };
    }
  }

  // 2bis) Lookup par full_name_key (si matricule absent)
  const existingByNameKey = new Map<string, ExistingStudent[]>();
  if (wantedNameKeys.length) {
    const { data: existing2, error: exErr2 } = await srv
      .from("students")
      .select(
        "id, matricule, full_name_key, first_name, last_name, gender, birthdate, birth_place, nationality, regime, is_repeater, is_boarder, is_affecte, photo_url"
      )
      .eq("institution_id", inst)
      .in("full_name_key", wantedNameKeys);

    if (exErr2) return NextResponse.json({ error: exErr2.message }, { status: 400 });

    for (const s of existing2 ?? []) {
      const row = s as any;
      const k = String(row.full_name_key || "").trim();
      if (!k) continue;

      const st: ExistingStudent = {
        id: String(row.id),
        matricule: row.matricule ?? null,
        full_name_key: row.full_name_key ?? null,
        first_name: row.first_name ?? null,
        last_name: row.last_name ?? null,
        gender: row.gender ?? null,
        birthdate: row.birthdate ?? null,
        birth_place: row.birth_place ?? null,
        nationality: row.nationality ?? null,
        regime: row.regime ?? null,
        is_repeater: typeof row.is_repeater === "boolean" ? row.is_repeater : null,
        is_boarder: typeof row.is_boarder === "boolean" ? row.is_boarder : null,
        is_affecte: typeof row.is_affecte === "boolean" ? row.is_affecte : null,
        photo_url: row.photo_url ?? null,
      };

      const arr = existingByNameKey.get(k) || [];
      arr.push(st);
      existingByNameKey.set(k, arr);
    }
  }

  // 3) Créer les élèves manquants (UNIQUEMENT si matricule présent)
  const toInsert = parsed
    .filter((r) => (r.matricule ?? "").trim() && !existingByMat[r.matricule!.trim()])
    .map((r) => ({
      institution_id: inst,
      first_name: r.first_name || null,
      last_name: r.last_name || null,
      full_name: r.full_name || null,
      full_name_key: r.full_name_key || null,
      matricule: r.matricule!.trim(),
      gender: r.gender || null,
      birthdate: r.birthdate || null,
      birth_place: r.birth_place || null,
      nationality: r.nationality || null,
      regime: r.regime || null,
      is_repeater: r.is_repeater ?? null,
      is_boarder: r.is_boarder ?? null,
      is_affecte: r.is_affecte ?? null,
      photo_url: r.photo_url ?? null,
    }));

  let createdCount = 0;

  if (toInsert.length) {
    const { data: createdRows, error: e1 } = await srv
      .from("students")
      .insert(toInsert)
      .select("id, matricule, full_name_key, first_name, last_name, photo_url");

    if (e1) return NextResponse.json({ error: e1.message }, { status: 400 });

    createdCount = (createdRows ?? []).length;

    for (const s of createdRows ?? []) {
      const row = s as any;
      const m = String(row.matricule || "").trim();
      if (!m) continue;
      existingByMat[m] = {
        id: String(row.id),
        matricule: row.matricule ?? null,
        full_name_key: row.full_name_key ?? null,
        first_name: row.first_name ?? null,
        last_name: row.last_name ?? null,
        gender: null,
        birthdate: null,
        birth_place: null,
        nationality: null,
        regime: null,
        is_repeater: null,
        is_boarder: null,
        is_affecte: null,
        photo_url: row.photo_url ?? null,
      };
    }
  }

  // 4) Mettre à jour identité + photo_url des existants (par matricule OU nom complet)
  function buildPatch(r: ParsedStudentRow, cur: ExistingStudent) {
    const patch: any = {};

    if (r.first_name && r.first_name !== (cur.first_name ?? "")) patch.first_name = r.first_name;
    if (r.last_name && r.last_name !== (cur.last_name ?? "")) patch.last_name = r.last_name;

    // maintenir full_name / key côté app (en plus du trigger)
    if (r.full_name && r.full_name !== "") patch.full_name = r.full_name;
    if (r.full_name_key && r.full_name_key !== "") patch.full_name_key = r.full_name_key;

    if (r.gender && r.gender !== (cur.gender ?? "")) patch.gender = r.gender;
    if (r.birthdate && r.birthdate !== (cur.birthdate ?? "")) patch.birthdate = r.birthdate;

    if (r.birth_place && r.birth_place !== (cur.birth_place ?? "")) patch.birth_place = r.birth_place;
    if (r.nationality && r.nationality !== (cur.nationality ?? "")) patch.nationality = r.nationality;
    if (r.regime && r.regime !== (cur.regime ?? "")) patch.regime = r.regime;

    if (typeof r.is_repeater === "boolean" && r.is_repeater !== cur.is_repeater)
      patch.is_repeater = r.is_repeater;
    if (typeof r.is_boarder === "boolean" && r.is_boarder !== cur.is_boarder)
      patch.is_boarder = r.is_boarder;
    if (typeof r.is_affecte === "boolean" && r.is_affecte !== cur.is_affecte)
      patch.is_affecte = r.is_affecte;

    if (r.photo_url && r.photo_url !== (cur.photo_url ?? "")) patch.photo_url = r.photo_url;

    return patch;
  }

  let updatedCount = 0;
  let updatedByName = 0;
  let ambiguousName = 0;

  // 4a) updates par matricule
  for (const r of parsed) {
    const m = String(r.matricule || "").trim();
    if (!m) continue;
    const cur = existingByMat[m];
    if (!cur) continue;

    const patch = buildPatch(r, cur);
    if (!Object.keys(patch).length) continue;

    const { error } = await srv.from("students").update(patch).eq("id", cur.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    updatedCount++;
  }

  // 4b) updates par nom complet (full_name_key) si pas de matricule
  for (const r of parsed) {
    const m = String(r.matricule || "").trim();
    if (m) continue;

    const key = String(r.full_name_key || "").trim();
    if (!key) continue;

    const matches = existingByNameKey.get(key) || [];
    if (matches.length === 0) continue;
    if (matches.length > 1) {
      ambiguousName++;
      continue; // on ne choisit pas au hasard
    }

    const cur = matches[0];
    const patch = buildPatch(r, cur);
    if (!Object.keys(patch).length) continue;

    const { error } = await srv.from("students").update(patch).eq("id", cur.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    updatedByName++;
  }

  // 5) IDs de tous les élèves importés (matricule + nom)
  const allStudentIds = new Set<string>();

  for (const r of parsed) {
    const m = String(r.matricule || "").trim();
    if (m && existingByMat[m]?.id) allStudentIds.add(existingByMat[m].id);
  }

  for (const r of parsed) {
    const m = String(r.matricule || "").trim();
    if (m) continue;
    const key = String(r.full_name_key || "").trim();
    if (!key) continue;
    const matches = existingByNameKey.get(key) || [];
    if (matches.length === 1) allStudentIds.add(matches[0].id);
  }

  if (!allStudentIds.size) {
    return NextResponse.json({
      inserted: createdCount,
      updated: updatedCount,
      updated_by_name: updatedByName,
      ambiguous_name: ambiguousName,
      closed_old_enrollments: 0,
      reactivated_in_target: 0,
      inserted_in_target: 0,
    });
  }

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const idsArr = Array.from(allStudentIds);

  // 6) Clôturer TOUTE inscription active du même élève dans une AUTRE classe
  let closedOld = 0;
  {
    const { data, error } = await srv
      .from("class_enrollments")
      .update({ end_date: today })
      .in("student_id", idsArr)
      .neq("class_id", class_id)
      .eq("institution_id", inst)
      .is("end_date", null)
      .select("id");

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    closedOld = (data ?? []).length;
  }

  // 7) Réactiver si une inscription cible existe déjà
  let reactivated = 0;
  {
    const { data, error } = await srv
      .from("class_enrollments")
      .update({ end_date: null })
      .in("student_id", idsArr)
      .eq("class_id", class_id)
      .eq("institution_id", inst)
      .select("id");

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    reactivated = (data ?? []).length;
  }

  // 8) Insérer celles qui n’existent pas encore
  let insertedTarget = 0;
  {
    const enrollRows = idsArr.map((sid) => ({
      class_id,
      student_id: sid,
      institution_id: inst,
      start_date: today,
      end_date: null,
    }));

    const { data, error } = await srv
      .from("class_enrollments")
      .upsert(enrollRows, {
        onConflict: "class_id,student_id",
        ignoreDuplicates: true,
      })
      .select("id");

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    insertedTarget = (data ?? []).length;
  }

  try {
    console.log("[students/import] commit", {
      class_id,
      createdCount,
      updatedCount,
      updatedByName,
      ambiguousName,
      closedOld,
      reactivated,
      insertedTarget,
    });
  } catch {}

  return NextResponse.json({
    inserted: createdCount,
    updated: updatedCount,
    updated_by_name: updatedByName,
    ambiguous_name: ambiguousName,
    closed_old_enrollments: closedOld,
    reactivated_in_target: reactivated,
    inserted_in_target: insertedTarget,
  });
}

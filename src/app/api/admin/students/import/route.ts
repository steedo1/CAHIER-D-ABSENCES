// src/app/api/admin/students/import/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import type { SupabaseClient } from "@supabase/supabase-js";
import { findStudentIdentityCandidates } from "@/lib/student-identity-conflicts";
import { studentFullIdentityKey } from "@/lib/student-class-membership";
import {
  synchronizeStudentFinance,
  type AppliedStudentFinanceSynchronization,
  type FinanceSyncResult,
} from "@/lib/finance/student-finance-sync";

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
  return String(s || "")
    .replace(/\s+/g, " ")
    .trim();
}
function makeFullNameKey(fullName: string) {
  return stripAccents(normSpaces(fullName)).toLowerCase();
}
function makeLooseIdentityKey(fullName: string) {
  return stripAccents(normSpaces(fullName))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** Détection du séparateur + guillemets */
function parseCSV(raw: string) {
  const firstNonEmpty =
    raw.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
  const sep = firstNonEmpty.includes("\t")
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
  const s = stripAccents(raw || "")
    .toLowerCase()
    .trim();
  if (!s) return null;
  if (["oui", "yes", "y", "1", "true", "vrai", "x"].includes(s)) return true;
  if (["non", "no", "0", "false", "faux"].includes(s)) return false;
  return null;
}

function parseAffectationCell(raw: string): boolean | null {
  const s = stripAccents(raw || "")
    .toLowerCase()
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;
  if (["aff", "affecte", "affectee", "reaffecte", "re affecte"].includes(s))
    return true;
  if (
    ["naff", "n aff", "non affecte", "non affectee", "nonaffecte"].includes(s)
  )
    return false;
  return parseBoolCell(raw);
}

function parseBoardingCell(raw: string): boolean | null {
  const s = stripAccents(raw || "")
    .toLowerCase()
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;
  if (["in", "int", "interne", "internat"].includes(s)) return true;
  if (["ext", "ex", "externe", "externat"].includes(s)) return false;
  return parseBoolCell(raw);
}

function parseGenderCell(raw: string): string | null {
  const s = stripAccents(raw || "")
    .toLowerCase()
    .trim();
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

function parseLv2Cell(raw: string): string | null {
  const v = String(raw || "").trim();
  if (!v) return null;
  return v.toUpperCase();
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
  lv2: string | null;
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
    h.replace(/[._-]/g, " ").replace(/\s+/g, " ").trim(),
  );
  const hCompact = (h: string) => h.replace(/[ .]/g, "");

  const idx = {
    numero: H.findIndex((h) => /^(n°|nº|no|numero|num|#)$/i.test(hCompact(h))),
    matric: H.findIndex((h) =>
      /^(matricule|matr|code|id|identifiant|matric)$/i.test(hCompact(h)),
    ),
    nom: H.findIndex((h) => /^(nom|last|surname)$/i.test(hCompact(h))),
    prenom: H.findIndex((h) =>
      /^(prenom|prenoms|first|given)$/i.test(hCompact(h)),
    ),
    fullname: H.findIndex((h) =>
      /^(nomcomplet|nometprenoms?|fullname|name|nomprenom?s?)$/i.test(
        hCompact(h),
      ),
    ),
    gender: H.findIndex((h) => /^(sexe|sex|genre|gender)$/i.test(hCompact(h))),
    birthdate: H.findIndex((h) =>
      /^(datenaissance|datedenaissance|birthdate|dateofbirth|dob)$/i.test(
        hCompact(h),
      ),
    ),
    birth_place: H.findIndex((h) =>
      /^(lieudenaissance|lieunaissance|birthplace|placeofbirth)$/i.test(
        hCompact(h),
      ),
    ),
    nationality: H.findIndex((h) =>
      /^(nationalite|nationality)$/i.test(hCompact(h)),
    ),
    lv2: H.findIndex((h) =>
      /^(lv2|langue2|languevivante2|deuxiemelangue|2elangue|languevivanteii)$/i.test(hCompact(h)),
    ),
    regime: H.findIndex((h) => /^(regime|statut|status)$/i.test(hCompact(h))),
    is_repeater: H.findIndex((h) =>
      /^(redoublant(e)?|redoublant|repeater|repeat)$/i.test(hCompact(h)),
    ),
    is_boarder: H.findIndex((h) =>
      /^(interne|externe|internat|externat|boarding|boarder)$/i.test(hCompact(h)),
    ),
    is_affecte: H.findIndex((h) =>
      /^(affecte(e)?|affectation|dec|decision)$/i.test(hCompact(h)),
    ),
    photo: H.findIndex((h) =>
      /^(photo|photourl|photo_url|image|imageurl|image_url|avatar|avatarurl|avatar_url|profil|profile)$/i.test(
        hCompact(h),
      ),
    ),
  };

  // Certains états officiels du CSCA utilisent un second en-tête "N°"
  // pour une colonne contenant en réalité In/Int/Ext. On ne l'infère que
  // lorsque les valeurs observées ressemblent clairement à un statut d'internat.
  if (idx.is_boarder < 0) {
    const numeroCandidates = H.map((h, index) => ({ h, index }))
      .filter(({ h }) => /^(n°|nº|no|numero|num|#)$/i.test(hCompact(h)))
      .map(({ index }) => index)
      .filter((index) => index !== idx.numero);

    for (const candidate of numeroCandidates) {
      let recognized = 0;
      let nonEmpty = 0;
      for (const cols of rows.slice(1)) {
        const raw = String(cols[candidate] ?? "").trim();
        if (!raw) continue;
        nonEmpty++;
        const token = stripAccents(raw)
          .toLowerCase()
          .replace(/[._-]+/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        if (
          ["in", "int", "interne", "internat", "ext", "ex", "externe", "externat"].includes(
            token,
          )
        ) {
          recognized++;
        }
      }
      if (recognized >= 2 && (nonEmpty === 0 || recognized / nonEmpty >= 0.5)) {
        idx.is_boarder = candidate;
        break;
      }
    }
  }

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

    const full_name = normSpaces(
      [last_name, first_name].filter(Boolean).join(" "),
    );
    const full_name_key = makeFullNameKey(full_name);

    const gender = idx.gender >= 0 ? parseGenderCell(cell(idx.gender)) : null;
    const birthdate =
      idx.birthdate >= 0 ? parseBirthdateCell(cell(idx.birthdate)) : null;
    const birth_place =
      idx.birth_place >= 0 ? cell(idx.birth_place) || null : null;
    const nationality =
      idx.nationality >= 0 ? cell(idx.nationality) || null : null;
    const lv2 = idx.lv2 >= 0 ? parseLv2Cell(cell(idx.lv2)) : null;
    const regime = idx.regime >= 0 ? cell(idx.regime) || null : null;

    const is_repeater =
      idx.is_repeater >= 0 ? parseBoolCell(cell(idx.is_repeater)) : null;
    const is_boarder =
      idx.is_boarder >= 0 ? parseBoardingCell(cell(idx.is_boarder)) : null;
    const is_affecte =
      idx.is_affecte >= 0 ? parseAffectationCell(cell(idx.is_affecte)) : null;

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
      lv2,
      regime,
      is_repeater,
      is_boarder,
      is_affecte,
      photo_url,
    };
  });

  return body.filter(
    (r) => r.last_name || r.first_name || r.matricule || r.photo_url,
  );
}

/* ───────── Guard admin ───────── */
type GuardOk = { userId: string; instId: string };
type GuardErr = { error: "unauthorized" | "no_institution" | "forbidden" };

async function guardAdmin(
  supa: SupabaseClient,
  srv: SupabaseClient,
): Promise<GuardOk | GuardErr> {
  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) return { error: "unauthorized" };

  // Important : dans cette base, le rôle n’est pas dans profiles.
  // La source fiable des rôles est public.user_roles.
  const { data: me } = await supa
    .from("profiles")
    .select("id, institution_id")
    .eq("id", user.id)
    .maybeSingle();

  const { data: urRows } = await srv
    .from("user_roles")
    .select("role, institution_id")
    .eq("profile_id", user.id);

  const adminRows = (urRows || []).filter((r) =>
    ["admin", "super_admin"].includes(String(r.role || "")),
  );

  let instId: string | null = (me?.institution_id as string) || null;
  if (!instId) {
    const roleInstitution = adminRows.find((r) => r.institution_id)?.institution_id;
    instId = roleInstitution ? String(roleInstitution) : null;
  }

  if (!instId) return { error: "no_institution" };
  if (adminRows.length === 0) return { error: "forbidden" };

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
      lv2: r.lv2 || null,
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
    .select(
      "id,institution_id,academic_year,label,code,level,official_track_code",
    )
    .eq("id", class_id)
    .maybeSingle();

  if (!cls || (cls as any).institution_id !== inst) {
    return NextResponse.json({ error: "invalid_class" }, { status: 400 });
  }
  if (!String((cls as any).academic_year || "").trim()) {
    return NextResponse.json(
      { error: "La classe cible n'a pas d'année scolaire." },
      { status: 400 },
    );
  }

  // 1) Matricules (distincts, non vides)
  const wantedMatr = Array.from(
    new Set(parsed.map((r) => (r.matricule ?? "").trim()).filter(Boolean)),
  );

  // 1bis) full_name_key (distincts) pour toutes les lignes.
  // Important : une fiche historique peut exister avec le nom uniquement. Quand
  // le fichier officiel apporte enfin son matricule, on doit enrichir cette même
  // fiche (et conserver son id/sa finance), pas créer un second élève.
  const wantedNameKeys = Array.from(
    new Set(
      parsed
        .map((r) => r.full_name_key)
        .filter(Boolean),
    ),
  );

  type ExistingStudent = {
    id: string;
    matricule: string | null;
    full_name: string | null;
    full_name_key: string | null;
    first_name: string | null;
    last_name: string | null;
    gender: string | null;
    birthdate: string | null;
    birth_place: string | null;
    nationality: string | null;
    lv2: string | null;
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
        "id, matricule, full_name, full_name_key, first_name, last_name, gender, birthdate, birth_place, nationality, lv2, regime, is_repeater, is_boarder, is_affecte, photo_url",
      )
      .eq("institution_id", inst)
      .or("lifecycle_status.is.null,lifecycle_status.neq.duplicate_merged")
      .in("matricule", wantedMatr);

    if (exErr)
      return NextResponse.json({ error: exErr.message }, { status: 400 });

    for (const s of existing ?? []) {
      const row = s as any;
      const m = String(row.matricule || "").trim();
      if (!m) continue;
      existingByMat[m] = {
        id: String(row.id),
        matricule: row.matricule ?? null,
        full_name: row.full_name ?? null,
        full_name_key: row.full_name_key ?? null,
        first_name: row.first_name ?? null,
        last_name: row.last_name ?? null,
        gender: row.gender ?? null,
        birthdate: row.birthdate ?? null,
        birth_place: row.birth_place ?? null,
        nationality: row.nationality ?? null,
        lv2: row.lv2 ?? null,
        regime: row.regime ?? null,
        is_repeater:
          typeof row.is_repeater === "boolean" ? row.is_repeater : null,
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
        "id, matricule, full_name, full_name_key, first_name, last_name, gender, birthdate, birth_place, nationality, lv2, regime, is_repeater, is_boarder, is_affecte, photo_url",
      )
      .eq("institution_id", inst)
      .or("lifecycle_status.is.null,lifecycle_status.neq.duplicate_merged")
      .in("full_name_key", wantedNameKeys);

    if (exErr2)
      return NextResponse.json({ error: exErr2.message }, { status: 400 });

    for (const s of existing2 ?? []) {
      const row = s as any;
      const k = String(row.full_name_key || "").trim();
      if (!k) continue;

      const st: ExistingStudent = {
        id: String(row.id),
        matricule: row.matricule ?? null,
        full_name: row.full_name ?? null,
        full_name_key: row.full_name_key ?? null,
        first_name: row.first_name ?? null,
        last_name: row.last_name ?? null,
        gender: row.gender ?? null,
        birthdate: row.birthdate ?? null,
        birth_place: row.birth_place ?? null,
        nationality: row.nationality ?? null,
        lv2: row.lv2 ?? null,
        regime: row.regime ?? null,
        is_repeater:
          typeof row.is_repeater === "boolean" ? row.is_repeater : null,
        is_boarder: typeof row.is_boarder === "boolean" ? row.is_boarder : null,
        is_affecte: typeof row.is_affecte === "boolean" ? row.is_affecte : null,
        photo_url: row.photo_url ?? null,
      };

      const arr = existingByNameKey.get(k) || [];
      arr.push(st);
      existingByNameKey.set(k, arr);
    }
  }

  // Index d'identité tolérant uniquement les différences de forme
  // (accents, espaces, apostrophes, tirets). Il sert à retrouver une fiche
  // historique sans matricule sans confondre deux identités différentes.
  const existingByLooseNameKey = new Map<string, ExistingStudent[]>();
  const existingByNormalizedMatricule = new Map<string, ExistingStudent>();
  const looseExisting: any[] = [];
  const loosePageSize = 1000;
  for (let from = 0; ; from += loosePageSize) {
    const { data: loosePage, error: loosePageErr } = await srv
      .from("students")
      .select(
        "id, matricule, full_name, full_name_key, first_name, last_name, gender, birthdate, birth_place, nationality, lv2, regime, is_repeater, is_boarder, is_affecte, photo_url",
      )
      .eq("institution_id", inst)
      .range(from, from + loosePageSize - 1);

    if (loosePageErr) {
      return NextResponse.json({ error: loosePageErr.message }, { status: 400 });
    }
    looseExisting.push(...(loosePage ?? []));
    if ((loosePage?.length ?? 0) < loosePageSize) break;
  }

  for (const s of looseExisting) {
    const row = s as any;
    const st: ExistingStudent = {
      id: String(row.id),
      matricule: row.matricule ?? null,
      full_name: row.full_name ?? null,
      full_name_key: row.full_name_key ?? null,
      first_name: row.first_name ?? null,
      last_name: row.last_name ?? null,
      gender: row.gender ?? null,
      birthdate: row.birthdate ?? null,
      birth_place: row.birth_place ?? null,
      nationality: row.nationality ?? null,
      lv2: row.lv2 ?? null,
      regime: row.regime ?? null,
      is_repeater:
        typeof row.is_repeater === "boolean" ? row.is_repeater : null,
      is_boarder:
        typeof row.is_boarder === "boolean" ? row.is_boarder : null,
      is_affecte:
        typeof row.is_affecte === "boolean" ? row.is_affecte : null,
      photo_url: row.photo_url ?? null,
    };

    const normalizedMatricule = String(st.matricule || "").trim().toUpperCase();
    if (normalizedMatricule) {
      existingByNormalizedMatricule.set(normalizedMatricule, st);
    }

    const identityKey = makeLooseIdentityKey(
      st.full_name || [st.last_name, st.first_name].filter(Boolean).join(" "),
    );
    if (!identityKey) continue;
    const arr = existingByLooseNameKey.get(identityKey) || [];
    if (!arr.some((candidate) => candidate.id === st.id)) arr.push(st);
    existingByLooseNameKey.set(identityKey, arr);
  }

  type StudentResolution =
    | {
        kind: "matricule" | "name";
        student: ExistingStudent;
      }
    | { kind: "none" | "ambiguous" | "conflict"; student: null };

  const normalizeMatricule = (value: string | null | undefined) =>
    String(value || "").trim().toUpperCase();

  function resolveExistingStudent(row: ParsedStudentRow): StudentResolution {
    const matricule = normalizeMatricule(row.matricule);
    const byMatricule = matricule
      ? existingByNormalizedMatricule.get(matricule) || existingByMat[matricule]
      : null;

    // Un matricule déjà attribué ne doit jamais servir à renommer silencieusement
    // un autre élève. Les seules différences tolérées ici sont typographiques
    // (accents, espaces, apostrophes et tirets).
    if (byMatricule) {
      const incomingIdentity = makeLooseIdentityKey(row.full_name);
      const currentIdentity = makeLooseIdentityKey(
        byMatricule.full_name ||
          [byMatricule.last_name, byMatricule.first_name]
            .filter(Boolean)
            .join(" "),
      );
      if (
        incomingIdentity &&
        currentIdentity &&
        incomingIdentity !== currentIdentity
      ) {
        return { kind: "conflict", student: null };
      }
      return { kind: "matricule", student: byMatricule };
    }

    const key = String(row.full_name_key || "").trim();
    const looseKey = makeLooseIdentityKey(row.full_name);
    const exactByName = key ? existingByNameKey.get(key) || [] : [];
    const looseByName = looseKey
      ? existingByLooseNameKey.get(looseKey) || []
      : [];
    const byName = Array.from(
      new Map(
        [...exactByName, ...looseByName].map((student) => [student.id, student]),
      ).values(),
    );

    if (!matricule) {
      if (byName.length === 1) return { kind: "name", student: byName[0] };
      return {
        kind: byName.length > 1 ? "ambiguous" : "none",
        student: null,
      };
    }

    // Si le même nom officiel existe déjà avec un autre matricule, on bloque :
    // il faut une décision humaine plutôt que créer/écraser une seconde identité.
    const conflictingMatricule = byName.some((student) => {
      const current = normalizeMatricule(student.matricule);
      return current && current !== matricule;
    });
    if (conflictingMatricule) {
      return { kind: "conflict", student: null };
    }

    const withoutMatricule = byName.filter(
      (student) => !normalizeMatricule(student.matricule),
    );
    if (withoutMatricule.length === 1) {
      return { kind: "name", student: withoutMatricule[0] };
    }
    if (withoutMatricule.length > 1) {
      return { kind: "ambiguous", student: null };
    }

    return { kind: "none", student: null };
  }

  const inputMatriculesByName = new Map<string, Set<string>>();
  const inputNamesByMatricule = new Map<string, Set<string>>();
  for (const row of parsed) {
    const nameKey = makeLooseIdentityKey(row.full_name);
    const matriculeKey = normalizeMatricule(row.matricule);
    if (nameKey && matriculeKey) {
      inputMatriculesByName.set(
        nameKey,
        new Set([...(inputMatriculesByName.get(nameKey) ?? []), matriculeKey]),
      );
      inputNamesByMatricule.set(
        matriculeKey,
        new Set([...(inputNamesByMatricule.get(matriculeKey) ?? []), nameKey]),
      );
    }
  }

  // Une variation JEAN-MARC / JEAN MARC ne doit pas créer une nouvelle fiche.
  // Signaler les correspondances normalisées sans les fusionner automatiquement.
  const unresolvedNames = parsed.filter((row) => resolveExistingStudent(row).kind === "none")
    .map((row) => row.full_name || `${row.last_name} ${row.first_name}`);
  let normalizedExistingNames: Set<string>;
  try {
    const candidates = await findStudentIdentityCandidates(srv, inst, unresolvedNames);
    normalizedExistingNames = new Set(candidates.map((row) => studentFullIdentityKey(
      [row.last_name, row.first_name].filter(Boolean).join(" ") || row.full_name,
    )));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Impossible de vérifier les identités." }, { status: 400 });
  }

  const identityConflictRows = Array.from(
    new Set(
      parsed
        .filter((row) => {
          const nameKey = makeLooseIdentityKey(row.full_name);
          const matriculeKey = normalizeMatricule(row.matricule);
          const inconsistentInput =
            (nameKey && (inputMatriculesByName.get(nameKey)?.size ?? 0) > 1) ||
            (matriculeKey &&
              (inputNamesByMatricule.get(matriculeKey)?.size ?? 0) > 1);
          if (inconsistentInput) return true;

          const resolution = resolveExistingStudent(row);
          return (
            resolution.kind === "conflict" ||
            resolution.kind === "ambiguous" ||
            (resolution.kind === "none" && normalizedExistingNames.has(studentFullIdentityKey(
              row.full_name || `${row.last_name} ${row.first_name}`,
            )))
          );
        })
        .map((row) => row._row + 2),
    ),
  ).sort((a, b) => a - b);

  if (identityConflictRows.length > 0) {
    return NextResponse.json(
      {
        error:
          "Import annulé : certaines identités sont ambiguës ou portent déjà un autre matricule.",
        identity_conflict_rows: identityConflictRows.slice(0, 100),
      },
      { status: 409 },
    );
  }

  const incompleteFinanceRows = parsed
    .filter((row) => {
      const resolution = resolveExistingStudent(row);
      const existing = resolution.student;
      const finalAffecte =
        typeof row.is_affecte === "boolean"
          ? row.is_affecte
          : existing?.is_affecte;
      const finalBoarder =
        typeof row.is_boarder === "boolean"
          ? row.is_boarder
          : existing?.is_boarder;
      return typeof finalAffecte !== "boolean" || typeof finalBoarder !== "boolean";
    })
    .map((row) => row._row + 2);


  // 3) Créer les élèves manquants (UNIQUEMENT si matricule présent)
  const toInsert = parsed
    .filter(
      (r) =>
        (r.matricule ?? "").trim() &&
        resolveExistingStudent(r).kind === "none",
    )
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
      lv2: r.lv2 || null,
      regime: r.regime || null,
      is_repeater: r.is_repeater ?? null,
      is_boarder: r.is_boarder ?? null,
      is_affecte: r.is_affecte ?? null,
      photo_url: r.photo_url ?? null,
    }));

  let createdCount = 0;
  const createdStudentIds = new Set<string>();

  if (toInsert.length) {
    const { data: createdRows, error: e1 } = await srv
      .from("students")
      .insert(toInsert)
      .select("id, matricule, full_name, full_name_key, first_name, last_name, gender, birthdate, birth_place, nationality, lv2, regime, is_repeater, is_boarder, is_affecte, photo_url");

    if (e1) return NextResponse.json({ error: e1.message }, { status: 400 });

    createdCount = (createdRows ?? []).length;

    for (const s of createdRows ?? []) {
      const row = s as any;
      const m = String(row.matricule || "").trim();
      if (!m) continue;
      createdStudentIds.add(String(row.id));
      existingByMat[m] = {
        id: String(row.id),
        matricule: row.matricule ?? null,
        full_name: row.full_name ?? null,
        full_name_key: row.full_name_key ?? null,
        first_name: row.first_name ?? null,
        last_name: row.last_name ?? null,
        gender: row.gender ?? null,
        birthdate: row.birthdate ?? null,
        birth_place: row.birth_place ?? null,
        nationality: row.nationality ?? null,
        lv2: row.lv2 ?? null,
        regime: row.regime ?? null,
        is_repeater: typeof row.is_repeater === "boolean" ? row.is_repeater : null,
        is_boarder: typeof row.is_boarder === "boolean" ? row.is_boarder : null,
        is_affecte: typeof row.is_affecte === "boolean" ? row.is_affecte : null,
        photo_url: row.photo_url ?? null,
      };
    }
  }

  // 4) Mettre à jour identité + photo_url des existants (par matricule OU nom complet)
  function buildPatch(r: ParsedStudentRow, cur: ExistingStudent) {
    const patch: any = {};

    const incomingMatricule = String(r.matricule || "").trim();
    const currentMatricule = String(cur.matricule || "").trim();
    if (incomingMatricule && !currentMatricule) {
      patch.matricule = incomingMatricule;
    }

    if (r.first_name && r.first_name !== (cur.first_name ?? ""))
      patch.first_name = r.first_name;
    if (r.last_name && r.last_name !== (cur.last_name ?? ""))
      patch.last_name = r.last_name;

    // maintenir full_name / key côté app (en plus du trigger)
    if (r.full_name && r.full_name !== "") patch.full_name = r.full_name;
    if (r.full_name_key && r.full_name_key !== "")
      patch.full_name_key = r.full_name_key;

    if (r.gender && r.gender !== (cur.gender ?? "")) patch.gender = r.gender;
    if (r.birthdate && r.birthdate !== (cur.birthdate ?? ""))
      patch.birthdate = r.birthdate;

    if (r.birth_place && r.birth_place !== (cur.birth_place ?? ""))
      patch.birth_place = r.birth_place;
    if (r.nationality && r.nationality !== (cur.nationality ?? ""))
      patch.nationality = r.nationality;
    if (r.lv2 && r.lv2 !== (cur.lv2 ?? "")) patch.lv2 = r.lv2;
    if (r.regime && r.regime !== (cur.regime ?? "")) patch.regime = r.regime;

    if (typeof r.is_repeater === "boolean" && r.is_repeater !== cur.is_repeater)
      patch.is_repeater = r.is_repeater;
    if (typeof r.is_boarder === "boolean" && r.is_boarder !== cur.is_boarder)
      patch.is_boarder = r.is_boarder;
    if (typeof r.is_affecte === "boolean" && r.is_affecte !== cur.is_affecte)
      patch.is_affecte = r.is_affecte;

    if (r.photo_url && r.photo_url !== (cur.photo_url ?? ""))
      patch.photo_url = r.photo_url;

    return patch;
  }

  let updatedCount = 0;
  let updatedByName = 0;
  let completedMatriculesByName = 0;
  let ambiguousName = 0;
  const studentUpdateSnapshots = new Map<string, Record<string, unknown>>();

  function rememberStudentSnapshot(student: ExistingStudent) {
    if (createdStudentIds.has(student.id) || studentUpdateSnapshots.has(student.id)) {
      return;
    }
    studentUpdateSnapshots.set(student.id, {
      first_name: student.first_name,
      last_name: student.last_name,
      full_name: student.full_name,
      full_name_key: student.full_name_key,
      gender: student.gender,
      birthdate: student.birthdate,
      birth_place: student.birth_place,
      nationality: student.nationality,
      lv2: student.lv2,
      regime: student.regime,
      is_repeater: student.is_repeater,
      is_boarder: student.is_boarder,
      is_affecte: student.is_affecte,
      photo_url: student.photo_url,
    });
  }

  async function rollbackStudentMutations() {
    for (const [studentId, snapshot] of studentUpdateSnapshots) {
      await srv
        .from("students")
        .update(snapshot as any)
        .eq("id", studentId)
        .eq("institution_id", inst);
    }
    if (createdStudentIds.size > 0) {
      await srv
        .from("students")
        .delete()
        .eq("institution_id", inst)
        .in("id", Array.from(createdStudentIds));
    }
  }

  // 4a) updates des lignes portant un matricule. Si ce matricule était absent
  // de la base, resolveExistingStudent peut avoir retrouvé la fiche unique par
  // son nom et buildPatch complète alors la fiche existante.
  for (const r of parsed) {
    const m = String(r.matricule || "").trim();
    if (!m) continue;
    const resolution = resolveExistingStudent(r);
    const cur = resolution.student;
    if (!cur) continue;

    const patch = buildPatch(r, cur);
    if (!Object.keys(patch).length) continue;

    rememberStudentSnapshot(cur);
    const { error } = await srv.from("students").update(patch).eq("id", cur.id);
    if (error) {
      await rollbackStudentMutations();
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    updatedCount++;
    if (resolution.kind === "name" && patch.matricule) {
      completedMatriculesByName++;
      cur.matricule = String(patch.matricule);
      existingByMat[m] = cur;
    }
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

    rememberStudentSnapshot(cur);
    const { error } = await srv.from("students").update(patch).eq("id", cur.id);
    if (error) {
      await rollbackStudentMutations();
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    updatedByName++;
  }

  // 5) IDs de tous les élèves importés (matricule + nom). On réutilise
  // exclusivement les fiches résolues ci-dessus : aucun élève existant n'est
  // supprimé parce qu'il est absent du fichier.
  const allStudentIds = new Set<string>();

  for (const r of parsed) {
    const resolution = resolveExistingStudent(r);
    if (resolution.student?.id) allStudentIds.add(resolution.student.id);
  }

  if (!allStudentIds.size) {
    return NextResponse.json({
      inserted: createdCount,
      updated: updatedCount,
      updated_by_name: updatedByName,
      completed_matricules_by_name: completedMatriculesByName,
      students_deleted: 0,
      ambiguous_name: ambiguousName,
      closed_old_enrollments: 0,
      reactivated_in_target: 0,
      inserted_in_target: 0,
    });
  }

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const idsArr = Array.from(allStudentIds);
  const targetAcademicYear = String((cls as any).academic_year || "").trim();

  const [sameYearResult, academicYearsResult] = await Promise.all([
    srv
      .from("classes")
      .select("id")
      .eq("institution_id", inst)
      .eq("academic_year", targetAcademicYear),
    srv
      .from("academic_years")
      .select("id,code,start_date,end_date")
      .eq("institution_id", inst),
  ]);

  if (sameYearResult.error) {
    await rollbackStudentMutations();
    return NextResponse.json(
      { error: sameYearResult.error.message },
      { status: 400 },
    );
  }
  if (academicYearsResult.error) {
    await rollbackStudentMutations();
    return NextResponse.json(
      { error: academicYearsResult.error.message },
      { status: 400 },
    );
  }

  const sameYearClassIds = (sameYearResult.data ?? [])
    .map((row: any) => String(row.id))
    .filter(Boolean);
  const academicYearEndByCode = new Map<string, string>();
  let targetAcademicYearId: string | null = null;
  let targetAcademicYearStartDate: string | null = null;

  for (const row of academicYearsResult.data ?? []) {
    const code = String((row as any).code || "").trim();
    const endDate = String((row as any).end_date || "").trim();
    if (code && endDate) academicYearEndByCode.set(code, endDate);
    if (code === targetAcademicYear) {
      targetAcademicYearId = String((row as any).id || "").trim() || null;
      targetAcademicYearStartDate =
        String((row as any).start_date || "").trim() || null;
    }
  }

  const { data: enrollmentSnapshotRows, error: enrollmentSnapshotError } =
    await srv
      .from("class_enrollments")
      .select(
        "id,institution_id,class_id,student_id,start_date,end_date,classes:class_id(academic_year)",
      )
      .eq("institution_id", inst)
      .in("student_id", idsArr);
  if (enrollmentSnapshotError) {
    await rollbackStudentMutations();
    return NextResponse.json(
      { error: enrollmentSnapshotError.message },
      { status: 400 },
    );
  }

  const enrollmentSnapshots = (enrollmentSnapshotRows || []).map((row: any) => {
    const relation = row?.classes;
    const academicYear = String(
      (Array.isArray(relation) ? relation[0] : relation)?.academic_year || "",
    ).trim();
    return {
      id: String(row.id),
      institution_id: String(row.institution_id),
      class_id: String(row.class_id),
      student_id: String(row.student_id),
      start_date: String(row.start_date),
      end_date: row.end_date ?? null,
      academic_year: academicYear,
    };
  });
  const enrollmentSnapshotIds = new Set(
    enrollmentSnapshots.map((row) => String(row.id)),
  );
  const financeApplications: AppliedStudentFinanceSynchronization[] = [];
  const financeSync: FinanceSyncResult = {
    inserted: 0,
    reactivated: 0,
    cancelled: 0,
    cancelled_duplicates: 0,
    preserved_paid_amount: 0,
    updated_amount: 0,
    retargeted: 0,
    option_links_created: 0,
    warnings: [],
  };
  const financeTransfer = {
    moved_charges: 0,
    retargeted_charges: 0,
    cancelled_duplicates: 0,
    preserved_paid_amount: 0,
    component_links_moved: 0,
    option_links_moved: 0,
    warnings: [] as string[],
  };

  async function rollbackFinanceApplications() {
    for (const applied of [...financeApplications].reverse()) {
      await applied.rollback();
    }
  }

  try {
    for (const studentId of idsArr) {
      const sourceClassIds = enrollmentSnapshots
        .filter(
          (row) =>
            row.student_id === studentId &&
            row.class_id !== class_id &&
            row.end_date === null &&
            row.academic_year === targetAcademicYear,
        )
        .map((row) => row.class_id);
      const applied = await synchronizeStudentFinance({
        srv: srv as any,
        institutionId: inst,
        userId: g.userId,
        studentId,
        sourceClassIds,
        targetClass: {
          id: String((cls as any).id),
          institution_id: inst,
          academic_year: targetAcademicYear,
          label: (cls as any).label ?? null,
          code: (cls as any).code ?? null,
          level: (cls as any).level ?? null,
          official_track_code: (cls as any).official_track_code ?? null,
        },
      });
      financeApplications.push(applied);

      for (const key of [
        "inserted",
        "reactivated",
        "cancelled",
        "cancelled_duplicates",
        "preserved_paid_amount",
        "updated_amount",
        "retargeted",
        "option_links_created",
      ] as const) {
        financeSync[key] += applied.reconciliation[key];
      }
      financeSync.warnings.push(...applied.reconciliation.warnings);
      financeTransfer.moved_charges += applied.transfer.moved_charges;
      financeTransfer.retargeted_charges += applied.transfer.retargeted_charges;
      financeTransfer.cancelled_duplicates +=
        applied.transfer.cancelled_duplicates;
      financeTransfer.preserved_paid_amount +=
        applied.transfer.preserved_paid_amount;
      financeTransfer.component_links_moved +=
        applied.transfer.component_links_moved;
      financeTransfer.option_links_moved += applied.transfer.option_links_moved;
      financeTransfer.warnings.push(...applied.transfer.warnings);
    }
  } catch (error) {
    await Promise.allSettled([rollbackFinanceApplications()]);
    await Promise.allSettled([rollbackStudentMutations()]);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "La synchronisation financière de l'import a échoué.",
        details: "Import annulé avant le changement des inscriptions.",
      },
      { status: 409 },
    );
  }

  async function rollbackEnrollmentMutations() {
    for (const snapshot of enrollmentSnapshots) {
      await srv
        .from("class_enrollments")
        .update({
          start_date: snapshot.start_date,
          end_date: snapshot.end_date,
        })
        .eq("id", snapshot.id)
        .eq("institution_id", inst);
    }

    const { data: currentTargets } = await srv
      .from("class_enrollments")
      .select("id")
      .eq("institution_id", inst)
      .eq("class_id", class_id)
      .in("student_id", idsArr);
    const insertedIds = (currentTargets || [])
      .map((row: any) => String(row.id))
      .filter((id) => !enrollmentSnapshotIds.has(id));
    if (insertedIds.length > 0) {
      await srv
        .from("class_enrollments")
        .delete()
        .eq("institution_id", inst)
        .in("id", insertedIds);
    }
  }

  let closedOld = 0;
  let reactivated = 0;
  let insertedTarget = 0;

  try {
    const activeSources = enrollmentSnapshots.filter(
      (row) => row.end_date === null && row.class_id !== class_id,
    );
    const groupedByCloseDate = new Map<string, string[]>();

    for (const row of activeSources) {
      const preferredCloseDate =
        row.academic_year && row.academic_year !== targetAcademicYear
          ? academicYearEndByCode.get(row.academic_year) || today
          : today;
      // Une inscription déjà planifiée peut commencer après la date du jour
      // (par exemple à la rentrée). La clôturer avant son début violerait
      // chk_dates_coherent. On la conserve dans l'historique en la clôturant
      // à sa propre date de début, sans supprimer la fiche ni ses finances.
      const closeDate =
        row.start_date > preferredCloseDate
          ? row.start_date
          : preferredCloseDate;
      groupedByCloseDate.set(closeDate, [
        ...(groupedByCloseDate.get(closeDate) ?? []),
        row.id,
      ]);
    }

    for (const [closeDate, enrollmentIds] of groupedByCloseDate) {
      const { data: closedRows, error: closeError } = await srv
        .from("class_enrollments")
        .update({ end_date: closeDate })
        .eq("institution_id", inst)
        .in("id", enrollmentIds)
        .select("id");
      if (closeError) throw new Error(closeError.message);
      closedOld += (closedRows ?? []).length;
    }

    const { data: reactivatedRows, error: reactivateError } = await srv
      .from("class_enrollments")
      .update({ end_date: null })
      .in("student_id", idsArr)
      .eq("class_id", class_id)
      .eq("institution_id", inst)
      .select("id");
    if (reactivateError) throw new Error(reactivateError.message);
    reactivated = (reactivatedRows ?? []).length;

    const { data: insertedRows, error: insertEnrollmentError } = await srv
      .from("class_enrollments")
      .upsert(
        idsArr.map((studentId) => ({
          class_id,
          student_id: studentId,
          institution_id: inst,
          start_date: targetAcademicYearStartDate || today,
          end_date: null,
        })),
        {
          onConflict: "class_id,student_id",
          ignoreDuplicates: true,
        },
      )
      .select("id");
    if (insertEnrollmentError) throw new Error(insertEnrollmentError.message);
    insertedTarget = (insertedRows ?? []).length;

    if (targetAcademicYearId) {
      const { data: profileStudents, error: profileStudentsError } = await srv
        .from("students")
        .select("id,is_affecte,is_boarder")
        .eq("institution_id", inst)
        .in("id", idsArr);
      if (profileStudentsError) throw new Error(profileStudentsError.message);

      const yearProfiles = (profileStudents ?? []).map((student: any) => {
        const affecte =
          typeof student.is_affecte === "boolean" ? student.is_affecte : null;
        const boarder =
          typeof student.is_boarder === "boolean" ? student.is_boarder : null;
        return {
          institution_id: inst,
          academic_year_id: targetAcademicYearId,
          academic_year: targetAcademicYear,
          student_id: String(student.id),
          class_id,
          level: String((cls as any).level || (cls as any).label || "unknown"),
          is_boarder: boarder === true,
          boarding_status_raw:
            boarder === null ? "unknown" : boarder ? "interne" : "externe",
          affectation_status:
            affecte === null ? "unknown" : affecte ? "affecte" : "non_affecte",
          affectation_status_raw:
            affecte === null ? "unknown" : affecte ? "affecte" : "non_affecte",
          billing_affectation_group:
            affecte === null ? "unknown" : affecte ? "affecte" : "non_affecte",
          scholarship_status: "unknown",
          source: "students_import",
          source_payload: { class_id },
          updated_at: new Date().toISOString(),
        };
      });

      if (yearProfiles.length > 0) {
        const { error: yearProfileError } = await srv
          .from("student_year_profiles")
          .upsert(yearProfiles, {
            onConflict: "institution_id,academic_year_id,student_id",
          });
        if (yearProfileError) throw new Error(yearProfileError.message);
      }
    }
  } catch (error) {
    const rollbackResults = [];
    rollbackResults.push(
      ...(await Promise.allSettled([rollbackEnrollmentMutations()])),
    );
    rollbackResults.push(
      ...(await Promise.allSettled([rollbackFinanceApplications()])),
    );
    rollbackResults.push(
      ...(await Promise.allSettled([rollbackStudentMutations()])),
    );
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "La mise à jour des inscriptions a échoué.",
        rollback_incomplete: rollbackResults.some(
          (result) => result.status === "rejected",
        ),
      },
      { status: 409 },
    );
  }

  // 9) Les champs officiels élève (sexe, naissance, nationalité, redoublant, LV2)
  // sont maintenant écrits directement dans public.students.
  // Ainsi les bulletins, conseils de classe, DESPS et autres exports peuvent les récupérer
  // depuis la source principale, sans table parallèle.
  const studentFieldsUpdated = updatedCount + updatedByName + createdCount;

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
      studentFieldsUpdated,
    });
  } catch {}

  return NextResponse.json({
    inserted: createdCount,
    updated: updatedCount,
    updated_by_name: updatedByName,
    completed_matricules_by_name: completedMatriculesByName,
    students_deleted: 0,
    ambiguous_name: ambiguousName,
    closed_old_enrollments: closedOld,
    reactivated_in_target: reactivated,
    inserted_in_target: insertedTarget,
    student_fields_updated: studentFieldsUpdated,
    finance_sync: {
      ...financeSync,
      warnings: Array.from(new Set(financeSync.warnings)),
    },
    finance_transfer: {
      ...financeTransfer,
      warnings: Array.from(new Set(financeTransfer.warnings)),
    },
    finance_profile_incomplete_rows: incompleteFinanceRows.slice(0, 100),
  });
}

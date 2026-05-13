// src/app/api/admin/institution/subject-coeffs/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { getMyInstitutionId } from "../../_helpers/getMyInstitution";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type IncomingCoeff = {
  level: string;
  subject_id: string;
  coeff: number;
};

type CoeffValue = {
  coeff: number;
  include_in_average: boolean;
  source_level: string;
};

const OFFICIAL_TRACK_CODES = [
  "6eme",
  "5eme",
  "4eme",
  "3eme",
  "2ndeA",
  "2ndeC",
  "1ereA1",
  "1ereA2",
  "1ereC",
  "1ereD",
  "tleA1",
  "tleA2",
  "tleC",
  "tleD",
] as const;

type OfficialTrackCode = (typeof OFFICIAL_TRACK_CODES)[number];

const OFFICIAL_TRACK_LABELS: Record<OfficialTrackCode, string> = {
  "6eme": "6ème",
  "5eme": "5ème",
  "4eme": "4ème",
  "3eme": "3ème",
  "2ndeA": "2nde A",
  "2ndeC": "2nde C",
  "1ereA1": "1ère A1",
  "1ereA2": "1ère A2",
  "1ereC": "1ère C",
  "1ereD": "1ère D",
  tleA1: "Tle A1",
  tleA2: "Tle A2",
  tleC: "Tle C",
  tleD: "Tle D",
};

const OFFICIAL_TRACK_ORDER = new Map<string, number>(
  OFFICIAL_TRACK_CODES.map((code, index) => [code, index]),
);

function normalizeText(value: unknown) {
  return String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function isOfficialTrackCode(value: string): value is OfficialTrackCode {
  return (OFFICIAL_TRACK_CODES as readonly string[]).includes(value);
}

function normalizeOfficialTrackCode(value: unknown): OfficialTrackCode | null {
  const raw = String(value ?? "").trim();
  if (isOfficialTrackCode(raw)) return raw;

  const normalized = normalizeText(raw);

  const exactByNormalized: Record<string, OfficialTrackCode> = {
    "6EME": "6eme",
    "6E": "6eme",
    SIXIEME: "6eme",
    "5EME": "5eme",
    "5E": "5eme",
    CINQUIEME: "5eme",
    "4EME": "4eme",
    "4E": "4eme",
    QUATRIEME: "4eme",
    "3EME": "3eme",
    "3E": "3eme",
    TROISIEME: "3eme",
    "2NDEA": "2ndeA",
    SECONDEA: "2ndeA",
    "2A": "2ndeA",
    "2NDEC": "2ndeC",
    SECONDEC: "2ndeC",
    "2C": "2ndeC",
    "1EREA1": "1ereA1",
    PREMIEREA1: "1ereA1",
    "1A1OFFICIEL": "1ereA1",
    "1EREA2": "1ereA2",
    PREMIEREA2: "1ereA2",
    "1EREC": "1ereC",
    PREMIEREC: "1ereC",
    "1C": "1ereC",
    "1ERED": "1ereD",
    PREMIERED: "1ereD",
    "1D": "1ereD",
    TLEA1: "tleA1",
    TERMINALEA1: "tleA1",
    TA1OFFICIEL: "tleA1",
    TLEA2: "tleA2",
    TERMINALEA2: "tleA2",
    TLEC: "tleC",
    TERMINALEC: "tleC",
    TC: "tleC",
    TLED: "tleD",
    TERMINALED: "tleD",
    TD: "tleD",
  };

  if (exactByNormalized[normalized]) return exactByNormalized[normalized];

  if (/^6/.test(normalized)) return "6eme";
  if (/^5/.test(normalized)) return "5eme";
  if (/^4/.test(normalized)) return "4eme";
  if (/^3/.test(normalized)) return "3eme";

  if (/^(2NDEA|2A|SECONDEA)/.test(normalized)) return "2ndeA";
  if (/^(2NDEC|2C|SECONDEC)/.test(normalized)) return "2ndeC";

  if (/^(1D|1ERED|PREMIERED)/.test(normalized)) return "1ereD";
  if (/^(1C|1EREC|PREMIEREC)/.test(normalized)) return "1ereC";

  // Par défaut métier validé : les anciennes classes 1A*, sans précision,
  // sont rattachées à 1ère A2. Les vraies A1 sont gérées via official_track_code.
  if (/^(1A|1EREA|PREMIEREA)/.test(normalized)) return "1ereA2";

  if (/^(TLED|TD|TERMINALED)/.test(normalized)) return "tleD";
  if (/^(TLEC|TC|TERMINALEC)/.test(normalized)) return "tleC";

  // Même logique pour Terminale A : TA* ancien = Tle A2 par défaut.
  if (/^(TLEA|TA|TERMINALEA)/.test(normalized)) return "tleA2";

  return null;
}

function resolveClassOfficialTrack(row: any): OfficialTrackCode | null {
  return (
    normalizeOfficialTrackCode(row?.official_track_code) ||
    normalizeOfficialTrackCode(row?.level) ||
    normalizeOfficialTrackCode(row?.label)
  );
}

function officialTrackLabel(level: string) {
  return isOfficialTrackCode(level) ? OFFICIAL_TRACK_LABELS[level] : level;
}

function sortLevels(a: string, b: string) {
  const ao = OFFICIAL_TRACK_ORDER.get(a) ?? 999;
  const bo = OFFICIAL_TRACK_ORDER.get(b) ?? 999;
  if (ao !== bo) return ao - bo;
  return officialTrackLabel(a).localeCompare(officialTrackLabel(b), "fr", {
    numeric: true,
    sensitivity: "base",
  });
}

function coefficientKey(level: string, subjectId: string) {
  return `${level}__${subjectId}`;
}

function normalizeCoeffValue(row: any): CoeffValue {
  return {
    coeff: Number(row.coeff ?? 1),
    include_in_average: row.include_in_average !== false,
    source_level: String(row.level || ""),
  };
}

export async function GET(_req: NextRequest) {
  const { institution_id, error } = await getMyInstitutionId();
  if (error) return error;

  const supabase = getSupabaseServiceClient();

  // 1) Niveaux/séries officiels de l’établissement.
  // On part désormais de classes.official_track_code. Le level/label ne sert
  // que de secours pour les anciennes classes non encore complétées.
  const { data: classRows, error: errClasses } = await supabase
    .from("classes")
    .select("level,label,official_track_code")
    .eq("institution_id", institution_id);

  if (errClasses) {
    return NextResponse.json(
      { ok: false, error: errClasses.message },
      { status: 400 },
    );
  }

  const levelSet = new Set<string>();
  (classRows || []).forEach((row: any) => {
    const official = resolveClassOfficialTrack(row);
    if (official) levelSet.add(official);
  });

  // 2) Matières de l’établissement (institution_subjects → subjects)
  const { data: subjectRows, error: errSubjects } = await supabase
    .from("institution_subjects")
    .select("subject_id, subjects(name)")
    .eq("institution_id", institution_id);

  if (errSubjects) {
    return NextResponse.json(
      { ok: false, error: errSubjects.message },
      { status: 400 },
    );
  }

  const subjects = (subjectRows || []).map((r: any) => ({
    subject_id: String(r.subject_id),
    subject_name: (r.subjects?.name as string) || "Matière",
  }));

  // 3) Coeffs existants.
  // On garde une compatibilité avec les anciens niveaux stockés : 1A, TA, 1D, etc.
  // Mais les nouvelles sauvegardes se font désormais sous le code officiel.
  const { data: coeffRows, error: errCoeffs } = await supabase
    .from("institution_subject_coeffs")
    .select("level, subject_id, coeff, include_in_average")
    .eq("institution_id", institution_id);

  if (errCoeffs) {
    return NextResponse.json(
      { ok: false, error: errCoeffs.message },
      { status: 400 },
    );
  }

  const exactByKey = new Map<string, CoeffValue>();
  const legacyByKey = new Map<string, CoeffValue>();

  (coeffRows || []).forEach((r: any) => {
    const rawLevel = String(r.level ?? "").trim();
    const subjectId = String(r.subject_id);
    if (!rawLevel || !subjectId) return;

    const official = normalizeOfficialTrackCode(rawLevel);
    const value = normalizeCoeffValue(r);

    if (official) {
      const key = coefficientKey(official, subjectId);
      if (isOfficialTrackCode(rawLevel)) {
        exactByKey.set(key, value);
      } else if (!legacyByKey.has(key)) {
        legacyByKey.set(key, value);
      }
      levelSet.add(official);
      return;
    }

    // Sécurité : on garde les éventuels niveaux personnalisés au lieu de les perdre.
    const key = coefficientKey(rawLevel, subjectId);
    exactByKey.set(key, value);
    levelSet.add(rawLevel);
  });

  const levels = Array.from(levelSet).sort(sortLevels);

  // 4) Grille complète série officielle × matière (coeff par défaut = 1)
  const items: {
    level: string;
    level_label: string;
    subject_id: string;
    subject_name: string;
    coeff: number;
    include_in_average: boolean;
  }[] = [];

  for (const level of levels) {
    for (const subj of subjects) {
      const key = coefficientKey(level, subj.subject_id);
      const existing = exactByKey.get(key) || legacyByKey.get(key);

      items.push({
        level,
        level_label: officialTrackLabel(level),
        subject_id: subj.subject_id,
        subject_name: subj.subject_name,
        coeff: existing ? existing.coeff : 1,
        include_in_average: existing ? existing.include_in_average : true,
      });
    }
  }

  items.sort((a, b) => {
    const lv = sortLevels(a.level, b.level);
    if (lv !== 0) return lv;
    return a.subject_name.localeCompare(b.subject_name, "fr", {
      sensitivity: "base",
    });
  });

  return NextResponse.json({ ok: true, items });
}

export async function PUT(req: NextRequest) {
  const { institution_id, error } = await getMyInstitutionId();
  if (error) return error;

  const body = await req.json().catch(() => ({}) as any);
  const incoming = Array.isArray(body.items)
    ? (body.items as IncomingCoeff[])
    : [];

  if (!incoming.length) {
    return NextResponse.json({ ok: false, error: "no_items" }, { status: 400 });
  }

  const rows = incoming
    .map((it) => {
      const rawLevel = (it.level ?? "").trim();
      const officialLevel = normalizeOfficialTrackCode(rawLevel);
      const level = officialLevel || rawLevel;
      const subject_id = (it.subject_id ?? "").trim();
      if (!level || !subject_id) return null;

      let coeff = Number(it.coeff);
      if (!Number.isFinite(coeff) || coeff < 0) coeff = 0;
      if (coeff > 99) coeff = 99;

      return {
        institution_id,
        level,
        subject_id,
        coeff,
        include_in_average: coeff > 0,
      };
    })
    .filter(Boolean) as {
    institution_id: string;
    level: string;
    subject_id: string;
    coeff: number;
    include_in_average: boolean;
  }[];

  if (!rows.length) {
    return NextResponse.json(
      { ok: false, error: "no_valid_items" },
      { status: 400 },
    );
  }

  const supabase = getSupabaseServiceClient();

  const { data, error: dbErr } = await supabase
    .from("institution_subject_coeffs")
    .upsert(rows, { onConflict: "institution_id,level,subject_id" })
    .select("level, subject_id, coeff");

  if (dbErr) {
    return NextResponse.json(
      { ok: false, error: dbErr.message },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, items: data ?? [] });
}

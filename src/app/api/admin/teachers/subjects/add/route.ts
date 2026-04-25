//src/app/api/admin/teachers/subjects/add/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// same normalization as DB trigger (remove accents, trim, lower)
function subjectKey(name: string): string {
  const ascii = String(name || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
  return ascii.replace(/\s+/g, " ").trim().toLowerCase();
}

function isUuid(v: string | null | undefined): boolean {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
    String(v || "")
  );
}

function slug(s: string) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeSubjectText(value: string | null | undefined) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

const SUBJECT_ALIAS_TO_CANONICAL: Record<string, string> = {
  math: "mathematiques",
  maths: "mathematiques",
  mathematique: "mathematiques",
  mathematiques: "mathematiques",

  francais: "francais",
  fr: "francais",
  french: "francais",

  anglais: "anglais",
  ang: "anglais",
  english: "anglais",

  allemand: "allemand",
  all: "allemand",
  allemandlv2: "allemand",

  espagnol: "espagnol",
  esp: "espagnol",
  espagnollv2: "espagnol",

  histoiregeographie: "histoiregeographie",
  histoiregeo: "histoiregeographie",
  histgeo: "histoiregeographie",
  hg: "histoiregeographie",
  hgeo: "histoiregeographie",
  histoire: "histoiregeographie",
  geographie: "histoiregeographie",

  physiquechimie: "physiquechimie",
  physique: "physiquechimie",
  chimie: "physiquechimie",
  pc: "physiquechimie",
  pch: "physiquechimie",

  svt: "svt",
  sciencenaturelle: "svt",
  sciencesnaturelles: "svt",
  sciencesdelavieetdelaterre: "svt",
  sciencesvieetterre: "svt",
  sciencevieetterre: "svt",

  eps: "eps",
  sport: "eps",
  educationphysique: "eps",
  educationphysiqueetsportive: "eps",

  edhc: "edhc",
  edh: "edhc",
  educationcivique: "edhc",
  educationauxdroitshumainsetalacitoyennete: "edhc",

  philosophie: "philosophie",
  philo: "philosophie",

  // ✅ Musique reste une discipline séparée.
  musique: "musique",
  music: "musique",
  educationmusicale: "musique",
  edmusicale: "musique",
  chant: "musique",

  // ✅ Arts plastiques / Dessin restent séparés de Musique.
  art: "artsplastiques",
  arts: "artsplastiques",
  artplastique: "artsplastiques",
  artplastiques: "artsplastiques",
  artsplastique: "artsplastiques",
  artsplastiques: "artsplastiques",
  dessin: "artsplastiques",
  dessins: "artsplastiques",
  educationartistique: "artsplastiques",
  artsvisuels: "artsplastiques",
};

function canonicalSubjectKey(value: string | null | undefined) {
  const raw = normalizeSubjectText(value);
  return SUBJECT_ALIAS_TO_CANONICAL[raw] || raw;
}

type SubjectLite = {
  id: string;
  name: string | null;
  code?: string | null;
  subject_key?: string | null;
};

export async function POST(req: NextRequest) {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const {
    data: { user },
  } = await supa.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({} as any));

  const profile_id =
    typeof body?.profile_id === "string" ? body.profile_id.trim() : "";

  const subject =
    typeof body?.subject === "string" ? body.subject.trim() : "";

  // ✅ subject_id canonique envoyé par le front si la matière existe déjà.
  const subjectIdRaw =
    typeof body?.subject_id === "string" && body.subject_id.trim()
      ? body.subject_id.trim()
      : null;

  if (!profile_id) {
    return NextResponse.json(
      { error: "profile_id requis" },
      { status: 400 }
    );
  }

  if (!(subjectIdRaw && isUuid(subjectIdRaw)) && !subject) {
    return NextResponse.json(
      { error: "subject requis" },
      { status: 400 }
    );
  }

  // Resolve current admin's institution
  let institution_id: string | null = null;

  {
    const { data: p } = await srv
      .from("profiles")
      .select("institution_id")
      .eq("id", user.id)
      .maybeSingle();

    institution_id = (p?.institution_id as string) ?? null;

    if (!institution_id) {
      const { data: ur } = await srv
        .from("user_roles")
        .select("institution_id")
        .eq("profile_id", user.id)
        .in("role", ["admin", "super_admin"])
        .limit(1)
        .maybeSingle();

      institution_id = (ur?.institution_id as string) ?? null;
    }
  }

  if (!institution_id) {
    return NextResponse.json(
      { error: "institution inconnue" },
      { status: 400 }
    );
  }

  let subject_id: string | null = null;
  let resolvedSubjectName = subject;
  let resolvedSubjectCode: string | null = null;

  // 1) Priorité absolue : subject_id canonique si envoyé par le front.
  if (subjectIdRaw && isUuid(subjectIdRaw)) {
    const byId = await srv
      .from("subjects")
      .select("id,name,code")
      .eq("id", subjectIdRaw)
      .maybeSingle();

    if (byId.error) {
      return NextResponse.json({ error: byId.error.message }, { status: 400 });
    }

    if (!byId.data?.id) {
      return NextResponse.json(
        { error: "subject_id introuvable" },
        { status: 400 }
      );
    }

    subject_id = String(byId.data.id);
    resolvedSubjectName = String(byId.data.name || subject || "Discipline");
    resolvedSubjectCode = byId.data.code ? String(byId.data.code) : null;
  }

  // 2) Sinon : résolution par alias/canonique pour éviter les doublons.
  if (!subject_id && subject) {
    const wantedCanonical = canonicalSubjectKey(subject);
    const wantedRaw = normalizeSubjectText(subject);
    const wantedDbKey = subjectKey(subject);

    const { data: allSubjects } = await srv
      .from("subjects")
      .select("id,name,code,subject_key")
      .limit(1000);

    const rows = (Array.isArray(allSubjects)
      ? allSubjects
      : []) as SubjectLite[];

    const found =
      rows.find((s) => canonicalSubjectKey(s.name) === wantedCanonical) ||
      rows.find((s) => normalizeSubjectText(s.name) === wantedRaw) ||
      rows.find((s) => normalizeSubjectText(s.code) === wantedRaw) ||
      rows.find((s) => String(s.subject_key || "") === wantedDbKey) ||
      null;

    if (found?.id) {
      subject_id = String(found.id);
      resolvedSubjectName = String(found.name || subject);
      resolvedSubjectCode = found.code ? String(found.code) : null;
    }
  }

  // 3) Fallback historique : subject_key exact.
  if (!subject_id && subject) {
    const key = subjectKey(subject);

    const found = await srv
      .from("subjects")
      .select("id,name,code")
      .eq("subject_key", key)
      .maybeSingle();

    if (found.data?.id) {
      subject_id = String(found.data.id);
      resolvedSubjectName = String(found.data.name || subject);
      resolvedSubjectCode = found.data.code ? String(found.data.code) : null;
    }
  }

  // 4) Dernier recours : création de la matière uniquement si elle n’existe vraiment pas.
  if (!subject_id && subject) {
    const code = slug(subject).slice(0, 12).toUpperCase();

    const ins = await srv
      .from("subjects")
      .insert({ name: subject, code })
      .select("id,name,code")
      .single();

    if (ins.error) {
      const key = subjectKey(subject);

      const reread = await srv
        .from("subjects")
        .select("id,name,code")
        .eq("subject_key", key)
        .maybeSingle();

      subject_id = reread.data?.id ? String(reread.data.id) : null;
      resolvedSubjectName = String(reread.data?.name || subject);
      resolvedSubjectCode = reread.data?.code ? String(reread.data.code) : code;
    } else {
      subject_id = ins.data?.id ? String(ins.data.id) : null;
      resolvedSubjectName = String(ins.data?.name || subject);
      resolvedSubjectCode = ins.data?.code ? String(ins.data.code) : code;
    }
  }

  if (!subject_id) {
    return NextResponse.json(
      { error: "subject introuvable/création échouée" },
      { status: 400 }
    );
  }

  // 5) Ensure the institution <-> subject row exists.
  const upInst = await srv
    .from("institution_subjects")
    .upsert(
      {
        institution_id,
        subject_id,
        is_active: true,
      },
      { onConflict: "institution_id,subject_id" }
    )
    .select("id")
    .single();

  if (upInst.error) {
    return NextResponse.json({ error: upInst.error.message }, { status: 400 });
  }

  // 6) Link the teacher to the subject for THIS institution (idempotent).
  const upTeach = await srv
    .from("teacher_subjects")
    .upsert(
      {
        profile_id,
        institution_id,
        subject_id,
      },
      { onConflict: "profile_id,institution_id,subject_id" }
    );

  if (upTeach.error) {
    return NextResponse.json({ error: upTeach.error.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    profile_id,
    subject_id,
    subject_name: resolvedSubjectName,
    subject_code: resolvedSubjectCode,
    institution_subject_id: upInst.data.id,
  });
}
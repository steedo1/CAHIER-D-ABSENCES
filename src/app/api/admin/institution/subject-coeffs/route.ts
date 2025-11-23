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

export async function GET(_req: NextRequest) {
  const { institution_id, error } = await getMyInstitutionId();
  if (error) return error;

  const supabase = getSupabaseServiceClient();

  // 1) Niveaux de l’établissement (via classes.level)
  const { data: classRows, error: errClasses } = await supabase
    .from("classes")
    .select("level")
    .eq("institution_id", institution_id);

  if (errClasses) {
    return NextResponse.json(
      { ok: false, error: errClasses.message },
      { status: 400 }
    );
  }

  const levelSet = new Set<string>();
  (classRows || []).forEach((r: any) => {
    const lvl = (r.level ?? "").trim();
    if (lvl) levelSet.add(lvl);
  });
  const levels = Array.from(levelSet);

  // 2) Matières de l’établissement (institution_subjects → subjects)
  const { data: subjectRows, error: errSubjects } = await supabase
    .from("institution_subjects")
    .select("subject_id, subjects(name)")
    .eq("institution_id", institution_id);

  if (errSubjects) {
    return NextResponse.json(
      { ok: false, error: errSubjects.message },
      { status: 400 }
    );
  }

  const subjects = (subjectRows || []).map((r: any) => ({
    subject_id: String(r.subject_id),
    subject_name: (r.subjects?.name as string) || "Matière",
  }));

  // 3) Coeffs existants
  const { data: coeffRows, error: errCoeffs } = await supabase
    .from("institution_subject_coeffs")
    .select("level, subject_id, coeff, include_in_average")
    .eq("institution_id", institution_id);

  if (errCoeffs) {
    return NextResponse.json(
      { ok: false, error: errCoeffs.message },
      { status: 400 }
    );
  }

  const byKey = new Map<string, { coeff: number; include_in_average: boolean }>();
  (coeffRows || []).forEach((r: any) => {
    const lvl = (r.level ?? "").trim();
    const sid = String(r.subject_id);
    if (!lvl || !sid) return;
    const key = `${lvl}__${sid}`;
    byKey.set(key, {
      coeff: Number(r.coeff ?? 1),
      include_in_average: r.include_in_average !== false,
    });
  });

  // 4) Grille complète niveau × matière (coeff par défaut = 1)
  const items: {
    level: string;
    subject_id: string;
    subject_name: string;
    coeff: number;
  }[] = [];

  for (const lvl of levels) {
    for (const subj of subjects) {
      const key = `${lvl}__${subj.subject_id}`;
      const existing = byKey.get(key);
      const coeff = existing ? existing.coeff : 1;

      items.push({
        level: lvl,
        subject_id: subj.subject_id,
        subject_name: subj.subject_name,
        coeff,
      });
    }
  }

  items.sort((a, b) => {
    const lv = a.level.localeCompare(b.level, undefined, { numeric: true });
    if (lv !== 0) return lv;
    return a.subject_name.localeCompare(b.subject_name, undefined, {
      sensitivity: "base",
    });
  });

  return NextResponse.json({ ok: true, items });
}

export async function PUT(req: NextRequest) {
  const { institution_id, error } = await getMyInstitutionId();
  if (error) return error;

  const body = await req.json().catch(() => ({} as any));
  const incoming = Array.isArray(body.items)
    ? (body.items as IncomingCoeff[])
    : [];

  if (!incoming.length) {
    return NextResponse.json(
      { ok: false, error: "no_items" },
      { status: 400 }
    );
  }

  const rows = incoming
    .map((it) => {
      const level = (it.level ?? "").trim();
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
      { status: 400 }
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
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true, items: data ?? [] });
}

//src/app/api/admin/timetables/import/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import {
  classMatchesEducationScope,
  getEducationScopeWriteError,
  readEducationScopeFromRecord,
  type EducationScopedClass,
} from "@/lib/education-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalize(str: string | null | undefined): string {
  return String(str || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

/**
 * Normalisation spécifique des labels de classe :
 * - normalise (minuscules, sans accents)
 * - supprime tous les espaces
 * ex: "1re D1" -> "1red1"
 */
function normalizeClasseLabel(str: string | null | undefined): string {
  const base = normalize(str);
  if (!base) return "";
  return base.replace(/\s+/g, "");
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set((arr || []).filter(Boolean))) as T[];
}

function buildPhoneVariants(raw: string) {
  const t = String(raw || "").trim();
  const digits = t.replace(/\D/g, "");
  const local10 = digits ? digits.slice(-10) : "";
  const localNo0 = local10.replace(/^0/, "");
  const cc = "225";
  const variants = uniq<string>([
    t,
    t.replace(/\s+/g, ""),
    digits,
    `+${digits}`,
    `+${cc}${local10}`,
    `+${cc}${localNo0}`,
    `00${cc}${local10}`,
    `00${cc}${localNo0}`,
    `${cc}${local10}`,
    `${cc}${localNo0}`,
    local10,
    localNo0 ? `0${localNo0}` : "",
  ]);
  return variants;
}

/**
 * Mini table d'alias de disciplines (clé et valeur déjà normalisées).
 * ex: "physiques-chimie" -> "physique-chimie"
 */
const DISCIPLINE_ALIASES: Record<string, string> = {
  "physiques-chimie": "physique-chimie",
  "physiques chimie": "physique-chimie",
  "physique chimie": "physique-chimie",
};

function normalizeDisciplineInput(raw: string | null | undefined): string {
  const base = normalize(raw);
  if (!base) return "";
  return DISCIPLINE_ALIASES[base] || base;
}

function parseWeekday(jour: string): number | null {
  const t = normalize(jour);
  if (!t) return null;
  if (/^(lundi|lun|mon|1)$/.test(t)) return 1;
  if (/^(mardi|mar|tue|2)$/.test(t)) return 2;
  if (/^(mercredi|mer|wed|3)$/.test(t)) return 3;
  if (/^(jeudi|jeu|thu|4)$/.test(t)) return 4;
  if (/^(vendredi|ven|fri|5)$/.test(t)) return 5;
  if (/^(samedi|sam|sat|6)$/.test(t)) return 6;
  if (/^(dimanche|dim|sun|0|7)$/.test(t)) return 0;
  return null;
}

/**
 * Normalise une heure saisie dans le CSV :
 * "7:10", "07:10", "07h10" → "07:10"
 */
function normalizeTimeInput(raw: string | null | undefined): string | null {
  const t = String(raw || "").trim();
  if (!t) return null;
  const replaced = t.replace(/[hH]/, ":");
  const m = replaced.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = m[1].padStart(2, "0");
  const mm = m[2];
  return `${hh}:${mm}`;
}

/**
 * Normalise une heure venant de la base :
 * "07:10", "07:10:00" → "07:10"
 */
function normalizeTimeFromDb(raw: string | null | undefined): string | null {
  const t = String(raw || "").trim();
  if (!t) return null;
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const hh = m[1].padStart(2, "0");
  const mm = m[2];
  return `${hh}:${mm}`;
}

type PeriodRow = {
  id: string;
  weekday: number;
  period_no: number;
  label?: string | null;
  start_time?: string | null;
  end_time?: string | null;
};

export async function POST(req: NextRequest) {
  try {
    const supa = await getSupabaseServerClient();
    const srv = getSupabaseServiceClient();

    const {
      data: { user },
    } = await supa.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    // Institution de l'utilisateur
    const { data: me, error: meErr } = await supa
      .from("profiles")
      .select("id,institution_id")
      .eq("id", user.id)
      .maybeSingle();
    if (meErr) {
      return NextResponse.json({ error: meErr.message }, { status: 400 });
    }
    const institution_id = me?.institution_id as string | null;
    if (!institution_id) {
      return NextResponse.json(
        {
          error: "no_institution",
          message: "Aucune institution associée à ce compte.",
        },
        { status: 400 }
      );
    }

    // Vérifier qu'il est admin / super_admin
    const { data: roleRow } = await supa
      .from("user_roles")
      .select("role")
      .eq("profile_id", user.id)
      .eq("institution_id", institution_id)
      .maybeSingle();
    const role = (roleRow?.role as string | undefined) || "";
    if (!["admin", "super_admin", "file_correspondent"].includes(role)) {
      return NextResponse.json(
        {
          error: "forbidden",
          message: "Droits insuffisants pour importer les emplois du temps.",
        },
        { status: 403 }
      );
    }

    const form = await req.formData();
    const file = form.get("file");
    const overwrite = String(form.get("overwrite") || "0") === "1";
    const scope = readEducationScopeFromRecord({
      education_type: form.get("education_type"),
      formation_code: form.get("formation_code"),
      formation_level_code: form.get("formation_level_code"),
      class_id: form.get("class_id"),
    });
    const scopeError = getEducationScopeWriteError(scope);

    if (scopeError) {
      return NextResponse.json(
        { error: "invalid_education_scope", message: scopeError },
        { status: 400 },
      );
    }

    if (!(file instanceof Blob)) {
      return NextResponse.json(
        {
          error: "missing_file",
          message: "Aucun fichier fourni (champ 'file').",
        },
        { status: 400 }
      );
    }

    const text = await file.text();
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (!lines.length) {
      return NextResponse.json(
        { error: "empty_file", message: "Le fichier est vide." },
        { status: 400 }
      );
    }

    // Déterminer le séparateur ; ou ,
    const detectSep = (line: string) => {
      const semi = (line.match(/;/g) || []).length;
      const comma = (line.match(/,/g) || []).length;
      return semi >= comma ? ";" : ",";
    };
    const sep = detectSep(lines[0]);
    const headerCols = lines[0].split(sep).map((c) => normalize(c));

    function colIndex(name: string): number {
      return headerCols.findIndex((c) => c === normalize(name));
    }

    const idxClasse = colIndex("classe");
    const idxEns = colIndex("enseignant_email_ou_tel");
    const idxDisc = colIndex("discipline");
    const idxJour = colIndex("jour");
    const idxStart = colIndex("heure_debut");
    const idxEnd = colIndex("heure_fin");
    const idxPerNo = colIndex("periode_no"); // optionnel

    if (
      idxClasse === -1 ||
      idxEns === -1 ||
      idxDisc === -1 ||
      idxJour === -1 ||
      idxStart === -1 ||
      idxEnd === -1
    ) {
      return NextResponse.json(
        {
          error: "invalid_header",
          message:
            "En-tête CSV invalide. Colonnes attendues au minimum : classe;enseignant_email_ou_tel;discipline;jour;heure_debut;heure_fin;[periode_no].",
        },
        { status: 400 }
      );
    }

    // L'import ne doit jamais résoudre une classe portant le même nom
    // dans une ancienne année scolaire.
    const { data: currentAcademicYear, error: academicYearErr } = await srv
      .from("academic_years")
      .select("code")
      .eq("institution_id", institution_id)
      .eq("is_current", true)
      .order("start_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (academicYearErr) {
      return NextResponse.json(
        { error: "academic_year_failed", message: academicYearErr.message },
        { status: 400 },
      );
    }

    const activeAcademicYear = currentAcademicYear?.code
      ? String(currentAcademicYear.code)
      : "";
    if (!activeAcademicYear) {
      return NextResponse.json(
        {
          error: "academic_year_not_found",
          message: "Aucune année scolaire active n'est configurée pour cet établissement.",
        },
        { status: 400 },
      );
    }

    // Précharger les données de l'établissement. Les classes sont ensuite
    // réduites au périmètre pédagogique choisi avant toute correspondance CSV.
    const [{ data: classes }, { data: subjects }, { data: profiles }, { data: periods }] =
      await Promise.all([
        srv
          .from("classes")
          .select(
            "id,label,level,education_type,formation_code,formation_level_code",
          )
          .eq("institution_id", institution_id)
          .eq("academic_year", activeAcademicYear),
        srv
          .from("institution_subjects")
          .select("id,custom_name,subjects:subject_id(name)")
          .eq("institution_id", institution_id),
        srv
          .from("profiles")
          .select("id,display_name,phone")
          .eq("institution_id", institution_id),
        srv
          .from("institution_periods")
          .select("id,weekday,period_no,label,start_time,end_time,duration_min")
          .eq("institution_id", institution_id),
      ]);

    const scopedClasses = (classes || [])
      .map((row: any) =>
        ({
          id: String(row.id),
          label: String(row.label || ""),
          level: row.level ? String(row.level) : null,
          education_type: row.education_type ?? null,
          formation_code: row.formation_code ?? null,
          formation_level_code: row.formation_level_code ?? null,
        }) satisfies EducationScopedClass,
      )
      .filter((row) => classMatchesEducationScope(row, scope));

    if (scopedClasses.length === 0) {
      return NextResponse.json(
        {
          error: "empty_education_scope",
          message: "Aucune classe ne correspond au périmètre sélectionné.",
        },
        { status: 400 },
      );
    }

    const scopedClassIds = scopedClasses.map((row) => row.id);
    const { data: assignments, error: assignmentErr } = await srv
      .from("class_teachers")
      .select("class_id,subject_id,teacher_id,end_date")
      .eq("institution_id", institution_id)
      .in("class_id", scopedClassIds)
      .is("end_date", null);

    if (assignmentErr) {
      return NextResponse.json(
        { error: "assignments_failed", message: assignmentErr.message },
        { status: 400 },
      );
    }

    const assignmentKeys = new Set(
      (assignments || []).map(
        (row: any) =>
          `${String(row.class_id)}::${String(row.subject_id)}::${String(row.teacher_id)}`,
      ),
    );

    // Plusieurs formations peuvent réutiliser le même libellé de classe.
    // Le périmètre lève normalement l'ambiguïté ; si deux classes du même
    // périmètre portent encore le même libellé, l'import refuse de deviner.
    const classIdsByLabel = new Map<string, string[]>();
    scopedClasses.forEach((row) => {
      const key = normalizeClasseLabel(row.label);
      if (!key) return;
      const current = classIdsByLabel.get(key) || [];
      current.push(row.id);
      classIdsByLabel.set(key, current);
    });

    const subjectByName = new Map<string, string>();
    (subjects || []).forEach((row) => {
      const s = row as {
        id: string;
        custom_name?: string | null;
        subjects?: { name?: string | null }[] | { name?: string | null } | null;
      };

      const cname = normalize(s.custom_name || "");

      let baseName = "";
      if (Array.isArray(s.subjects)) {
        baseName = s.subjects[0]?.name || "";
      } else if (s.subjects && typeof s.subjects === "object") {
        baseName = (s.subjects as any).name || "";
      }

      const sname = normalize(baseName);

      if (cname) subjectByName.set(cname, s.id);
      if (sname) subjectByName.set(sname, s.id);
    });

    // Professeurs : on matche d'abord sur display_name, puis éventuellement sur le téléphone
    const teacherByName = new Map<string, string>();
    const teacherByPhone = new Map<string, string>();
    (profiles || []).forEach((p: any) => {
      const id = p.id as string;
      const normName = normalize(p.display_name);
      if (normName) {
        teacherByName.set(normName, id);
      }
      if (p.phone) {
        const variants = buildPhoneVariants(String(p.phone));
        variants.forEach((v) => teacherByPhone.set(v, id));
      }
    });

    const periodByWeekdayAndNo = new Map<string, PeriodRow>();
    const periodByWeekdayAndTime = new Map<string, PeriodRow>();
    (periods || []).forEach((p: any) => {
      const weekday = typeof p.weekday === "number" ? p.weekday : null;
      const perNo = typeof p.period_no === "number" ? p.period_no : null;
      const startNorm = normalizeTimeFromDb(p.start_time);
      const endNorm = normalizeTimeFromDb(p.end_time);
      const row = p as PeriodRow;

      if (weekday !== null && perNo !== null) {
        const keyNo = `${weekday}|${perNo}`;
        periodByWeekdayAndNo.set(keyNo, row);
      }
      if (weekday !== null && startNorm && endNorm) {
        const keyTime = `${weekday}|${startNorm}|${endNorm}`;
        periodByWeekdayAndTime.set(keyTime, row);
      }
    });

    const errors: string[] = [];
    const toInsert: any[] = [];

    for (let i = 1; i < lines.length; i++) {
      const raw = lines[i];
      if (!raw.trim()) continue;

      const cols = raw.split(sep);
      const classe = cols[idxClasse] ?? "";
      const ensIdent = cols[idxEns] ?? "";
      const disc = cols[idxDisc] ?? "";
      const jour = cols[idxJour] ?? "";
      const startRaw = cols[idxStart] ?? "";
      const endRaw = cols[idxEnd] ?? "";

      const lineNo = i + 1;
      const normClasse = normalizeClasseLabel(classe);
      const normDisc = normalizeDisciplineInput(disc);
      const weekday = parseWeekday(jour);
      const startNorm = normalizeTimeInput(startRaw);
      const endNorm = normalizeTimeInput(endRaw);

      if (!normClasse) {
        errors.push(`Ligne ${lineNo}: classe vide.`);
        continue;
      }
      if (!ensIdent.trim()) {
        errors.push(`Ligne ${lineNo}: enseignant vide.`);
        continue;
      }
      if (!normDisc) {
        errors.push(`Ligne ${lineNo}: discipline vide.`);
        continue;
      }
      if (weekday === null) {
        errors.push(`Ligne ${lineNo}: jour "${jour}" invalide.`);
        continue;
      }
      if (!startNorm || !endNorm) {
        errors.push(
          `Ligne ${lineNo}: heure_debut "${startRaw}" ou heure_fin "${endRaw}" invalide (format attendu HH:MM).`
        );
        continue;
      }

      const matchingClassIds = classIdsByLabel.get(normClasse) || [];
      if (matchingClassIds.length === 0) {
        errors.push(
          `Ligne ${lineNo}: classe "${classe}" introuvable dans le périmètre pédagogique sélectionné.`
        );
        continue;
      }
      if (matchingClassIds.length > 1) {
        errors.push(
          `Ligne ${lineNo}: le libellé de classe "${classe}" est ambigu dans ce périmètre. Renommez les classes concernées ou importez une classe précise.`
        );
        continue;
      }
      const class_id = matchingClassIds[0];

      const subject_id = subjectByName.get(normDisc);
      if (!subject_id) {
        errors.push(
          `Ligne ${lineNo}: discipline "${disc}" introuvable dans l'établissement.`
        );
        continue;
      }

      // Recherche de l'enseignant :
      // 1) par nom (display_name)
      // 2) sinon par téléphone (si l'admin a mis un numéro dans le CSV)
      let teacher_id: string | undefined;
      const normTeacher = normalize(ensIdent);

      if (teacherByName.has(normTeacher)) {
        teacher_id = teacherByName.get(normTeacher)!;
      } else {
        const variants = buildPhoneVariants(ensIdent);
        for (const v of variants) {
          if (teacherByPhone.has(v)) {
            teacher_id = teacherByPhone.get(v)!;
            break;
          }
        }
      }

      if (!teacher_id) {
        errors.push(
          `Ligne ${lineNo}: enseignant "${ensIdent}" introuvable (ni nom ni téléphone ne correspondent dans l'établissement).`
        );
        continue;
      }

      if (!assignmentKeys.has(`${class_id}::${subject_id}::${teacher_id}`)) {
        errors.push(
          `Ligne ${lineNo}: l'enseignant "${ensIdent}" n'est pas affecté à la discipline "${disc}" dans la classe "${classe}" pour ce périmètre.`
        );
        continue;
      }

      // periode_no optionnel : on essaie d'abord par numéro, puis par heures
      let perNo: number | null = null;
      if (idxPerNo !== -1) {
        const perNoRaw = cols[idxPerNo] ?? "";
        if (perNoRaw.trim() !== "") {
          const n = Number.parseInt(perNoRaw, 10);
          if (Number.isFinite(n)) {
            perNo = n;
          } else {
            errors.push(
              `Ligne ${lineNo}: periode_no "${perNoRaw}" invalide (ignoré, on tente de retrouver le créneau avec les heures).`
            );
          }
        }
      }

      let period: PeriodRow | undefined;
      if (perNo !== null) {
        const keyNo = `${weekday}|${perNo}`;
        period = periodByWeekdayAndNo.get(keyNo);
      }
      if (!period) {
        const keyTime = `${weekday}|${startNorm}|${endNorm}`;
        period = periodByWeekdayAndTime.get(keyTime);
      }
      if (!period) {
        errors.push(
          `Ligne ${lineNo}: aucun créneau institutionnel pour jour=${jour}, ${startNorm}-${endNorm}.`
        );
        continue;
      }

      toInsert.push({
        institution_id,
        class_id,
        subject_id,
        teacher_id,
        weekday,
        period_id: period.id,
        created_by: user.id,
      });
    }

    if (!toInsert.length) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "Aucune ligne valide à importer. Vérifiez le fichier et les messages d’erreur.",
          errors,
        },
        { status: 400 }
      );
    }

    const { error: insErr, count } = await srv
      .from("teacher_timetables")
      .upsert(toInsert, {
        count: "exact",
        onConflict:
          "institution_id,class_id,subject_id,teacher_id,weekday,period_id",
        ignoreDuplicates: !overwrite,
      });

    if (insErr) {
      return NextResponse.json(
        { ok: false, error: insErr.message, errors },
        { status: 400 }
      );
    }

    const inserted = typeof count === "number" ? count : toInsert.length;

    return NextResponse.json({
      ok: true,
      inserted,
      skipped: errors.length,
      message: `${inserted} lignes importées, ${errors.length} ignorées.`,
      errors,
      scope,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "import_failed" },
      { status: 500 }
    );
  }
}

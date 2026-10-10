import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Issue = {
  className: string;
  studentName: string;
  matricule: string;
  code: string;
  detail: string;
  severity: "blocking";
};

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizedGender(value: unknown): "F" | "M" | null {
  const s = clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  if (["M", "MASCULIN", "GARCON"].includes(s)) return "M";
  if (["F", "FEMININ", "FILLE"].includes(s)) return "F";
  return null;
}

export async function GET(req: NextRequest) {
  const client = await getSupabaseServerClient();
  const { data: { user }, error: userError } = await client.auth.getUser();
  if (userError || !user) return NextResponse.json({ error: "Connexion requise." }, { status: 401 });

  const { data: role, error: roleError } = await client
    .from("user_roles").select("institution_id, role")
    .eq("profile_id", user.id)
    .in("role", ["admin", "super_admin", "file_correspondent"])
    .limit(1).maybeSingle();

  if (roleError || !role?.institution_id) {
    return NextResponse.json({ error: "Accès correspondant fichier non autorisé." }, { status: 403 });
  }

  const url = new URL(req.url);
  const academicYear = clean(url.searchParams.get("academic_year"));
  const classId = clean(url.searchParams.get("class_id"));
  if (!/^\d{4}-\d{4}$/.test(academicYear) ||
      (classId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(classId))) {
    return NextResponse.json({ error: "Année scolaire ou classe invalide." }, { status: 400 });
  }

  const admin = getSupabaseServiceClient();
  let query = admin.from("classes").select("id,label,code,academic_year")
    .eq("institution_id", String(role.institution_id))
    .eq("academic_year", academicYear)
    .or("education_type.eq.general_secondary,education_type.is.null");

  if (classId) query = query.eq("id", classId);

  const { data: classes, error: classError } = await query.order("label");
  if (classError) return NextResponse.json({ error: "Impossible de lire les classes." }, { status: 503 });
  if (!classes?.length) return NextResponse.json({ error: "Aucune classe pour cette année scolaire." }, { status: 404 });

  const byClass = new Map(classes.map(cls => [String(cls.id), clean(cls.label || cls.code || "Classe")]));
  type Enrollment = {
    id: string;
    class_id: string;
    student_id: string;
    students?: {
      first_name?: string | null;
      last_name?: string | null;
      full_name?: string | null;
      matricule?: string | null;
      gender?: string | null;
    } | null;
  };

  const enrollments: Enrollment[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    if (offset >= 20000) {
      return NextResponse.json({ error: "Trop d'inscriptions : sélectionner des classes séparément." }, { status: 422 });
    }
    const { data, error } = await admin.from("class_enrollments")
      .select("id,class_id,student_id,students(first_name,last_name,full_name,matricule,gender)")
      .in("class_id", [...byClass.keys()])
      .is("end_date", null)
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) {
      return NextResponse.json({ error: "Impossible de récupérer la liste complète des inscriptions." }, { status: 503 });
    }
    const page = (data || []) as Enrollment[];
    enrollments.push(...page);
    if (page.length < pageSize) break;
  }

  const issues: Issue[] = [];
  const groupedMatricules = new Map<string, Array<{ className: string; studentName: string; matricule: string }>>();
  const enrolledStudents = new Map<string, string[]>();
  let girls = 0;
  let boys = 0;
  let unknown = 0;

  const issue = (className: string, studentName: string, matricule: string, code: string, detail: string) => {
    issues.push({ className, studentName, matricule, code, detail, severity: "blocking" });
  };

  for (const enrollment of enrollments) {
    const cls = byClass.get(String(enrollment.class_id)) || "Classe inconnue";
    const student = enrollment.students || {};
    const fullName = clean(student.full_name) ||
      [clean(student.last_name), clean(student.first_name)].filter(Boolean).join(" ");
    const name = fullName || "(identité absente)";
    const mat = clean(student.matricule);
    const gender = normalizedGender(student.gender);
    if (!fullName) issue(cls, name, mat, "IDENTITE_ABSENTE", "Nom et prénoms absents");
    if (!mat) issue(cls, name, mat, "MATRICULE_ABSENT", "Matricule national non renseigné");
    if (!gender) {
      unknown += 1;
      issue(cls, name, mat, "SEXE_INCONNU", "Sexe absent ou non reconnu");
    } else if (gender === "F") girls += 1;
    else boys += 1;

    if (mat) {
      const key = mat.toUpperCase().replace(/\s/g, "");
      groupedMatricules.set(key, [...(groupedMatricules.get(key) || []), { className: cls, studentName: name, matricule: mat }]);
    }
    const studentId = clean(enrollment.student_id);
    enrolledStudents.set(studentId, [...(enrolledStudents.get(studentId) || []), cls]);
  }

  for (const duplicates of groupedMatricules.values()) {
    if (duplicates.length < 2) continue;
    for (const duplicate of duplicates) {
      issue(duplicate.className, duplicate.studentName, duplicate.matricule,
        "MATRICULE_DOUBLON", "Matricule présent sur plusieurs inscriptions actives de la sélection");
    }
  }

  for (const [studentId, places] of enrolledStudents) {
    if (places.length < 2) continue;
    for (const enrollment of enrollments.filter(row => clean(row.student_id) === studentId)) {
      const student = enrollment.students || {};
      issue(byClass.get(enrollment.class_id) || "", clean(student.full_name) ||
        [clean(student.last_name), clean(student.first_name)].filter(Boolean).join(" "),
        clean(student.matricule), "INSCRIPTIONS_MULTIPLES",
        "Élève présent sur plusieurs inscriptions actives : " + places.join(", "));
    }
  }

  const alerts: string[] = [];
  if (enrollments.length >= 20 && (girls === 0 || boys === 0)) {
    alerts.push("Répartition filles/garçons inhabituelle : vérifier les sexes enregistrés avant toute statistique officielle.");
  }
  if (classId) alerts.push("Contrôle limité à la classe sélectionnée : les éventuels doublons avec d'autres classes ne sont pas détectés.");
  alerts.push("Le rapprochement ACTU-ELEVES et la conformité d'import SIGFNE restent à vérifier avec les données officielles.");

  const byCode = issues.reduce<Record<string, number>>((out, item) => {
    out[item.code] = (out[item.code] || 0) + 1;
    return out;
  }, {});

  return NextResponse.json({
    ok: true,
    academicYear,
    scope: classId ? byClass.get(classId) : "Toutes les classes",
    classes: classes.length,
    enrollments: enrollments.length,
    girls,
    boys,
    unknown,
    blockingCount: issues.length,
    byCode,
    issues,
    alerts,
    generatedAt: new Date().toISOString(),
  }, { headers: { "Cache-Control": "no-store" } });
}

import { cleanNumberOrNull, type AiStudentSignal } from "@/lib/mon-cahier-ai/core";
type SchoolClass = { id: string; label: string; level: string | null };
type Json = Record<string, any>;
function average(values: number[]) { return values.length ? Math.round(values.reduce((sum, n) => sum + n, 0) / values.length * 100) / 100 : null; }

/** Missing grades stay unknown. Only official values with academic evidence enter the conversation. */
export function summarizeBulletin(json: Json, cls: SchoolClass, annual = false) {
  const rows = Array.isArray(json.items) ? json.items : [];
  const means: number[] = [];
  let partial = 0;
  const follow: AiStudentSignal[] = [];
  const subjects = new Map<string, { name: string; values: number[] }>();
  const names = new Map<string, string>((json.subjects || []).map((s: Json) => [String(s.subject_id || s.id), String(s.subject_name || s.name || "Matière")]));
  for (const row of rows) {
    const value = cleanNumberOrNull(annual ? row.annual_avg : row.general_avg);
    const status = String(annual ? row.annual_avg_status || "" : row.general_avg_status || "");
    const valid = value != null && value >= 0 && value <= 20 && !["empty", "admin_nc", "not_last_period"].includes(status)
      && row.coverage?.has_academic_grade !== false && row.coverage?.status !== "empty";
    if (valid) {
      means.push(value!);
      if ((annual ? row.annual_coverage_is_complete : row.coverage_is_complete) !== true) partial++;
      if (value! < 10) follow.push({ student_id: String(row.student_id), full_name: String(row.full_name || "Élève"),
        class_id: cls.id, class_label: cls.label, general_avg_20: value, p_success: null, risk_level: "unknown", priority_score: 0,
        reasons: ["Moyenne officielle disponible sous 10/20 ; vérifier la couverture des matières avant de conclure."] });
    }
    if (annual) continue;
    for (const subject of Array.isArray(row.per_subject) ? row.per_subject : []) {
      const score = cleanNumberOrNull(subject.avg20);
      if (score == null || score < 0 || score > 20 || subject.has_grade === false || subject.is_nc === true) continue;
      const id = String(subject.subject_id || ""); if (!id) continue;
      const entry = subjects.get(id) || { name: names.get(id) || String(subject.subject_name || "Matière"), values: [] };
      entry.values.push(score); subjects.set(id, entry);
    }
  }
  return { facts: { classe: cls.label, eleves_dans_le_bulletin: rows.length, moyennes_disponibles: means.length,
    eleves_sans_moyenne: rows.length - means.length, moyennes_avec_matieres_manquantes: partial,
    moyenne_des_moyennes_disponibles_sur_20: average(means), moyennes_disponibles_sous_10: means.length ? means.filter(n => n < 10).length : null,
    matieres: Array.from(subjects.values()).map(s => ({ matiere: s.name, moyennes_disponibles: s.values.length, moyenne_des_moyennes_sur_20: average(s.values) })),
    limite: "Constats sur les données publiées disponibles, sans prédiction de réussite ou d'échec." },
    follow: follow.sort((a,b) => a.general_avg_20! - b.general_avg_20!) };
}


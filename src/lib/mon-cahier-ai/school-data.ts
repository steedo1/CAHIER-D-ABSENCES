import { cleanNumberOrNull, cleanText, levelMatches, type AiStudentSignal } from "./core";
import type { SchoolQuestion } from "./conversation";
import { readTeachers } from "./teacher-data";

type SchoolClass = { id: string; label: string; level: string | null };
type Period = { id: string; label: string; code: string; start_date: string; end_date: string };
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

export function createSchoolReader(args: {
  srv: any; institutionId: string; academicYear: string; referenceDate: string;
  bulletin: (classId: string, from: string, to: string) => Promise<Json>; dashboard: (days: number) => Promise<Json>;
}) {
  let classesPromise: Promise<SchoolClass[]> | undefined;
  const followById = new Map<string, AiStudentSignal>();
  async function classes() {
    return classesPromise ??= (async () => {
      const rows: SchoolClass[] = [];
      for (let start = 0; ; start += 1000) {
        const {data,error} = await args.srv.from("classes").select("id,label,level").eq("institution_id",args.institutionId)
          .eq("academic_year",args.academicYear).order("id",{ascending:true}).range(start,start+999);
        if (error) throw new Error("classes_unavailable"); rows.push(...(data || []));
        if (!data || data.length < 1000) return rows;
      }
    })();
  }
  const normalized = (text: string) => cleanText(text).replace(/\s/g, "");
  async function read(question: SchoolQuestion): Promise<unknown> {
    if (question.consultation === "assiduite") {
      if (question.jours === 1) return {indisponible:"Le tableau de bord des absences élèves disponible ici couvre 7, 30 ou 90 jours."};
      if (question.classe || question.niveau) return {indisponible:"L'assiduité disponible ici concerne l'établissement entier. Le détail de cette classe doit être consulté dans le cahier des absences."};
      const json = await args.dashboard(question.jours);
      if (!json.ok || json.meta?.academic_year !== args.academicYear) return {indisponible:"Le tableau de bord ne correspond pas à l'année scolaire sélectionnée."};
      return {source:"Tableau de bord établissement",annee_scolaire:json.meta.academic_year,jours:json.meta.days,date_fin:new Date().toISOString().slice(0,10),
        absences_enregistrees:json.kpis?.absences ?? null,retards_enregistres:json.kpis?.retards ?? null,
        limite:"Ce sont des enregistrements d'appel, pas nécessairement des élèves distincts ni des heures."};
    }
    const all = await classes();
    const selected = all.filter(cls => (!question.classe || normalized(cls.label) === normalized(question.classe))
      && (!question.niveau || levelMatches(cls.level || cls.label,question.niveau)));
    if (!selected.length) return {aucune_classe:true,annee_scolaire:args.academicYear,classes_disponibles:all.map(c=>c.label)};
    if (question.consultation === "enseignants") return readTeachers({srv:args.srv,institutionId:args.institutionId,academicYear:args.academicYear,referenceDate:args.referenceDate,classes:selected,question});
    if (question.consultation === "classes") return {annee_scolaire:args.academicYear,classes:selected.map(c=>({classe:c.label,niveau:c.level})),nombre_classes:selected.length};
    if (question.consultation === "effectifs") {
      const students = new Set<string>(); const byClass = new Map<string,Set<string>>(selected.map(c=>[c.id,new Set<string>()]));
      for (let i=0;i<selected.length;i+=80) {
        const ids=selected.slice(i,i+80).map(c=>c.id);
        for (let start=0;;start+=1000) {
          const {data,error}=await args.srv.from("class_enrollments").select("student_id,class_id").eq("institution_id",args.institutionId)
            .in("class_id",ids).is("end_date",null).order("id",{ascending:true}).range(start,start+999);
          if(error) throw new Error("roster_unavailable");
          for(const row of data || []) if(row.student_id && byClass.has(row.class_id)) {students.add(String(row.student_id));byClass.get(row.class_id)!.add(String(row.student_id));}
          if(!data || data.length<1000) break;
        }
      }
      return {source:"Inscriptions actives, élèves distincts",annee_scolaire:args.academicYear,eleves_inscrits:students.size,nombre_classes:selected.length,
        classes:selected.map(c=>({classe:c.label,eleves_inscrits:byClass.get(c.id)!.size}))};
    }
    if(selected.length>25) return {precision_necessaire:"Précise une classe ou un niveau pour consulter les résultats officiels."};
    const {data,error}=await args.srv.from("grade_periods").select("id,label,code,start_date,end_date").eq("institution_id",args.institutionId)
      .eq("academic_year",args.academicYear).order("start_date",{ascending:true});
    if(error) throw new Error("periods_unavailable");
    const periods=(data || []).filter((p:Period)=>p.start_date && p.end_date) as Period[];
    const annual=question.periode==="annuelle";
    const current=periods.find(p=>p.start_date.slice(0,10)<=args.referenceDate && p.end_date.slice(0,10)>=args.referenceDate)
      || [...periods].reverse().find(p=>p.end_date.slice(0,10)<args.referenceDate);
    const period=annual?periods.at(-1):question.periode==="courante"?current:periods[Number(question.periode.slice(1))-1];
    if(!period || (annual && args.referenceDate<period.end_date.slice(0,10))) return {indisponible:annual?"L'année scolaire n'est pas terminée ; aucun bilan annuel complet ne peut encore être conclu.":"Aucune période de notes correspondante n'est configurée à cette date."};
    const facts:unknown[]=[]; const unavailable:string[]=[];
    for(let i=0;i<selected.length;i+=4) await Promise.all(selected.slice(i,i+4).map(async cls=>{
      try {
        const json=await args.bulletin(cls.id,period.start_date.slice(0,10),period.end_date.slice(0,10));
        if(!json.ok) throw new Error("bulletin_unavailable"); const summary=summarizeBulletin(json,cls,annual);facts.push(summary.facts);
        if(question.detail==="eleves_a_accompagner") for(const student of summary.follow) followById.set(student.student_id,student);
      } catch {unavailable.push(cls.label);}
    }));
    return {source:"Bulletins officiels Mon Cahier",annee_scolaire:args.academicYear,periode:annual?"Année complète":period.label || period.code,
      debut:period.start_date.slice(0,10),fin:period.end_date.slice(0,10),classes:facts,classes_indisponibles:unavailable,
      liste_nominative_affichee_separement:question.detail==="eleves_a_accompagner" && followById.size>0};
  }
  return {read,studentsToFollow:()=>Array.from(followById.values()).sort((a,b)=>a.general_avg_20!-b.general_avg_20!).slice(0,8)};
}

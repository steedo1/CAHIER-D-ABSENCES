import { cleanText } from "./core";
import type { SchoolQuestion } from "./conversation";

type SchoolClass = { id: string; label: string; level: string | null };
type Row = Record<string, any>;
async function pages(query: (start: number, end: number) => any): Promise<Row[]> {
  const rows: Row[] = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await query(start, start + 999);
    if (error) throw new Error("teacher_data_unavailable");
    rows.push(...(data || []));
    if (!data || data.length < 1000) return rows;
  }
}
const relation = (value: any) => Array.isArray(value) ? value[0] : value;
const subjectText = (value: unknown) => cleanText(value).replace(/\bmaths?\b/g, "mathematiques").replace(/\s/g, "");

export async function readTeachers(args: {
  srv: any; institutionId: string; academicYear: string; referenceDate: string;
  classes: SchoolClass[]; question: SchoolQuestion;
}) {
  const { srv, institutionId, question } = args;
  const roles = await pages((start, end) => srv.from("user_roles").select("profile_id")
    .eq("institution_id", institutionId).eq("role", "teacher").order("profile_id").range(start, end));
  const teacherIds = [...new Set(roles.map(row => String(row.profile_id || "")).filter(Boolean))];
  if (question.detail === "synthese" && !question.classe && !question.niveau && !question.enseignant && !question.discipline) {
    return { source: "Comptes ayant le rôle enseignant dans l'établissement", enseignants_enregistres: teacherIds.length,
      annee_des_affectations: args.academicYear, limite: "Le vivier de comptes n'est pas une preuve d'affectation ni d'activité cette année." };
  }
  const profiles: Row[] = [];
  for (let i = 0; i < teacherIds.length; i += 80) profiles.push(...await pages((start, end) => srv.from("profiles")
    .select("id,display_name").in("id", teacherIds.slice(i, i + 80)).order("id").range(start, end)));
  const assignments: Row[] = [];
  for (let i = 0; i < args.classes.length; i += 80) assignments.push(...await pages((start, end) => srv.from("class_teachers")
    .select("id,teacher_id,class_id,subject_id,instsub:institution_subjects(id,custom_name,subj:subjects(id,name))")
    .eq("institution_id", institutionId).is("end_date", null).in("class_id", args.classes.slice(i, i + 80).map(cls => cls.id))
    .order("id").range(start, end)));
  const directIds = [...new Set(assignments.filter(row => !relation(row.instsub)).map(row => row.subject_id).filter(Boolean))];
  const directNames = new Map<string, string>();
  for (let i = 0; i < directIds.length; i += 80) {
    const { data, error } = await srv.from("subjects").select("id,name").in("id", directIds.slice(i, i + 80));
    if (error) throw new Error("subjects_unavailable");
    for (const row of data || []) directNames.set(row.id, row.name);
  }
  const classNames = new Map(args.classes.map(cls => [cls.id, cls.label]));
  function subjectName(row: Row) {
    const inst = relation(row.instsub);
    return String(inst?.custom_name || relation(inst?.subj)?.name || directNames.get(row.subject_id) || "Matière non renseignée");
  }
  const matchingAssignments = assignments.filter(row => !question.discipline || subjectText(subjectName(row)).includes(subjectText(question.discipline)));
  const wantedName = cleanText(question.enseignant).replace(/\b(m|mr|monsieur|mme|madame|professeur|prof)\b/g, " ").trim();
  let selected = profiles.filter(profile => !wantedName || wantedName.split(/\s+/).every(token => cleanText(profile.display_name).includes(token)));
  if (question.classe || question.niveau || question.discipline) selected = selected.filter(profile => matchingAssignments.some(row => row.teacher_id === profile.id));
  if (!selected.length) return { aucun_enseignant: true, annee_scolaire: args.academicYear, precision: "Aucun enseignant ne correspond à ce nom et à ces affectations dans l'établissement sélectionné." };
  if (wantedName && selected.length > 1) return { precision_necessaire: "Plusieurs enseignants correspondent. Précise le nom complet.", noms: selected.map(p => p.display_name) };
  const visible = selected.slice(0, 60);
  const slots: Row[] = [];
  const periods = new Map<string, Row>();
  if (question.detail === "affectations") {
    for (let i = 0; i < args.classes.length; i += 80) slots.push(...await pages((start, end) => srv.from("teacher_timetables")
      .select("id,teacher_id,class_id,subject_id,weekday,period_id").eq("institution_id", institutionId)
      .in("class_id", args.classes.slice(i, i + 80).map(cls => cls.id)).order("id").range(start, end)));
    for (const period of await pages((start, end) => srv.from("institution_periods").select("id,label,weekday,start_time,end_time")
      .eq("institution_id", institutionId).order("id").range(start, end))) periods.set(period.id, period);
  }
  const sessions: Row[] = [];
  const end = new Date(`${args.referenceDate}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + 1);
  const start = new Date(end); start.setUTCDate(start.getUTCDate() - question.jours);
  if (question.detail === "appels") {
    for (let i = 0; i < visible.length; i += 80) sessions.push(...await pages((from, to) => srv.from("teacher_sessions")
      .select("id,teacher_id,class_id,started_at,actual_call_at,ended_at").eq("institution_id", institutionId)
      .in("teacher_id", visible.slice(i, i + 80).map(p => p.id)).gte("started_at", start.toISOString()).lt("started_at", end.toISOString())
      .order("id").range(from, to)));
  }
  return {
    source: "Comptes enseignants et affectations actives Mon Cahier ; séances d'appel horodatées si demandées",
    annee_scolaire: args.academicYear, enseignants_correspondants: selected.length, liste_tronquee: visible.length < selected.length,
    enseignants: visible.map(profile => {
      const own = matchingAssignments.filter(row => row.teacher_id === profile.id);
      const ownSessions = sessions.filter(row => row.teacher_id === profile.id && classNames.has(row.class_id));
      return { nom: profile.display_name || "Nom non renseigné",
        affectations: [...new Map(own.map(row => { const item = { classe: classNames.get(row.class_id), discipline: subjectName(row) }; return [JSON.stringify(item), item]; })).values()],
        ...(question.detail === "affectations" ? { creneaux_programmes: slots.filter(row => row.teacher_id === profile.id).slice(0, 60).map(row => ({
          classe: classNames.get(row.class_id), jour: ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"][Number(row.weekday) % 7],
          debut: periods.get(row.period_id)?.start_time ?? null, fin: periods.get(row.period_id)?.end_time ?? null,
        })) } : {}),
        ...(question.detail === "appels" ? { activite: { du: start.toISOString().slice(0, 10), au: args.referenceDate,
          seances_demarrees: ownSessions.length, appels_horodates: ownSessions.filter(row => row.actual_call_at).length,
          seances_terminees: ownSessions.filter(row => row.ended_at).length } } : {}),
      };
    }),
    limite: "Une séance ou un appel manquant ne prouve pas une absence du professeur. Les oublis et retards de synchronisation sont possibles. Les horaires décrivent l'emploi du temps actuel, sans preuve de réalisation. Aucun jugement disciplinaire n'est établi.",
  };
}

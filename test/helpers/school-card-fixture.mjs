import { randomUUID } from "node:crypto";
import { createMulticycleFixture, createFixtureRouteLoader } from "./multicycle-fixture.mjs";
export const year = "2026-2027";
export function schoolCardFixture(count = 10, bilingual = false) {
  const db = createMulticycleFixture();
  const school = db.tables.institutions[0];
  Object.assign(school, { name: bilingual ? "EPC Dimbokro — DONNÉES FICTIVES" : "CSCA — DONNÉES FICTIVES", phone: "+225 0000000000", logo_url: null, country_name: "République de Côte d’Ivoire", country_motto: "Union - Discipline - Travail", ministry_name: "", head_name: "Directeur fictif", head_title: "Directeur", subscription_expires_at: "2027-07-30" });
  const fr = randomUUID(), ar = randomUUID();
  if (bilingual) school.settings_json = {
    school_cycles_v1: { version: 1, enabled: true, enabledCycles: ["primary"], classCycleById: { [fr]: "primary", [ar]: "primary" }, teachingTracksByCycle: { primary: ["french", "arabic"] } },
    school_student_programs_v1: { version: 1, years: { [year]: { classes: { [fr]: { tracks: ["french"], students: {} }, [ar]: { tracks: ["arabic"], students: {} } } } } },
    school_teaching_signatories_v1: { version: 1, french: { name: "Nimaga Adam Ousmane" }, arabic: { name: "Traoré Daouda" } },
  };
  db.tables.classes = [{ id: fr, label: bilingual ? "CP1 FR" : "6e A", level: bilingual ? "CP1" : "6e", institution_id: db.legacyId, academic_year: year }, { id: ar, label: bilingual ? "CP1 AR" : "6e B", level: bilingual ? "CP1" : "6e", institution_id: db.legacyId, academic_year: year }];
  db.tables.academic_years = [{ id: randomUUID(), code: year, institution_id: db.legacyId, start_date: "2026-08-31", end_date: "2027-07-30", is_current: true }];
  db.tables.school_card_settings = []; db.tables.school_card_revocations = []; db.tables.students = [];
  for (let i = 0; i < count; i++) {
    const student = { id: randomUUID(), institution_id: db.legacyId, full_name: i < 2 ? "Traoré Ousmane" : `Élève fictif ${String(i).padStart(4,"0")}`, matricule: `EPC26${String(i+1).padStart(4,"0")}`, birthdate: "2016-05-12", birth_place: "Yamoussoukro", gender: i % 2 ? "F" : "M", lifecycle_status: "active", photo_path: null };
    db.tables.students.push(student);
    db.tables.class_enrollments.push({ id: randomUUID(), student_id: student.id, class_id: i % 2 ? ar : fr, institution_id: db.legacyId, start_date: "2026-08-31", end_date: null });
  }
  const base = db.service.from;
  db.service.from = table => {
    const query = base(table);
    const eq = query.eq.bind(query);
    query.eq = (key,value) => { if (!key.includes(".")) return eq(key,value); query.filters.push(row => key.split(".").reduce((part,k) => part?.[k],row) === value); return query; };
    // range() clones a query; projections must exist before any filter executes.
    for (const row of db.tables.class_enrollments) {
      row.students = db.tables.students.find(s => s.id === row.student_id);
      row.classes = db.tables.classes.find(c => c.id === row.class_id);
    }
    return query;
  };
  const files = new Map();
  db.files = files;
  db.service.storage = {
    getBucket: async () => ({ data: { public: false }, error: null }),
    from: bucket => ({
      createSignedUrls: async paths => { db.calls.push({ table: `storage:${bucket}`, op: "sign-batch", count: paths.length }); return { data: paths.map(path => ({ path, signedUrl: `http://127.0.0.1/photo/${encodeURIComponent(path)}` })), error: null }; },
      download: async path => ({ data: files.has(path) ? new Blob([files.get(path)], { type: "image/png" }) : null, error: files.has(path) ? null : { message: "missing" } }),
      upload: async (path,bytes) => { files.set(path,bytes); return { data: { path }, error: null }; },
      remove: async paths => { paths.forEach(path => files.delete(path)); return { error: null }; },
    }),
  };
  db.load = actor => createFixtureRouteLoader(db,actor);
  db.admin = db.load(db.legacyAdminId);
  db.addActor = (role, institutionId = db.legacyId) => {
    const id = randomUUID(); db.users.set(id,{user:db.user(id,`${role}@example.invalid`)});
    db.tables.profiles.push({ id, institution_id: institutionId });
    db.tables.user_roles.push({ profile_id:id, institution_id: institutionId, role }); return id;
  };
  return db;
}
export function request(path, body, method = body ? "POST" : "GET", headers = {}) {
  const url = new URL(path,"https://cards.example.invalid");
  return Object.assign(new Request(url,{ method, headers: { origin:url.origin,...(body ? {"Content-Type":"application/json"}:{}),...headers }, ...(body ? {body:JSON.stringify(body)}:{}) }),{ nextUrl:url });
}

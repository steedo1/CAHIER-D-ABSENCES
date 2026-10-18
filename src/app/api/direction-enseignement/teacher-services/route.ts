import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { requireTeachingDirector } from "@/lib/auth/teaching-director";
import { parseSchoolCyclesSettings } from "@/lib/school-cycles";
import { directorClassPermitted, directorSubjectPermitted } from "@/lib/school-director-resource-scope";
import { readClassSubjects } from "@/lib/school-class-subjects";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const send = (body: unknown, status = 200) => NextResponse.json(body,
  { status, headers: { "Cache-Control": "private, no-store" } });
const validOrigin = (req: NextRequest) => !req.headers.get("origin") ||
  req.headers.get("origin") === req.nextUrl.origin;

type TeacherRow = { profile_id: string; subject_id: string };
type Assignment = {
  id: string; teacher_id: string; subject_id: string;
  class_id: string; start_date: string; end_date: string | null;
};

/** Validate scope BEFORE reading profiles or touching any class service. */
async function scopedClass(classId: string) {
  const browser = await getSupabaseServerClient();
  const service = getSupabaseServiceClient();
  const access = await requireTeachingDirector(browser, service);
  if (!access.ok) return { error: send({ ok: false, error: access.error }, access.status) } as const;
  if (!UUID.test(classId)) return { error: send({ ok: false, error: "invalid_class" }, 400) } as const;
  const { institutionId, teachingTrack } = access.principal;
  const [inst, year] = await Promise.all([
    service.from("institutions").select("settings_json")
      .eq("id", institutionId).maybeSingle(),
    service.from("academic_years").select("code").eq("institution_id", institutionId)
      .eq("is_current", true).limit(1).maybeSingle(),
  ]);
  if (inst.error || year.error || !inst.data || !year.data?.code)
    return { error: send({ ok: false, error: "school_settings_unavailable" }, 503) } as const;
  const school = parseSchoolCyclesSettings(inst.data.settings_json);
  const { data: classroom, error: classError } = await service.from("classes")
    .select("id,label,level,academic_year,institution_id")
    .eq("institution_id", institutionId).eq("id", classId)
    .eq("academic_year", year.data.code).maybeSingle();
  if (classError) return { error: send({ ok: false, error: "class_unavailable" }, 503) } as const;
  if (!classroom || !directorClassPermitted(inst.data.settings_json, year.data.code,
      teachingTrack, [classroom], classId)) {
    return { error: send({ ok: false, error: "foreign_class_or_teaching" }, 403) } as const;
  }
  const cycle = school.classCycleById[classId];
  if (!cycle || !access.principal.cycles.includes(cycle))
    return { error: send({ ok: false, error: "foreign_cycle" }, 403) } as const;
  const mappedIds = readClassSubjects(inst.data.settings_json)
    ?.years[year.data.code]?.classes[classId];
  if (!mappedIds) return { error: send({ ok: false, error: "class_subjects_not_configured" }, 409) } as const;
  const { data: active, error: activeError } = await service.from("institution_subjects")
    .select("id,subject_id,custom_name").eq("institution_id", institutionId)
    .eq("is_active", true).limit(501);
  if (activeError || !active || active.length > 500)
    return { error: send({ ok: false, error: "institution_subjects_unavailable" }, 503) } as const;
  const allowed = active.filter(row => mappedIds.includes(row.subject_id) &&
    directorSubjectPermitted(school, cycle, teachingTrack, row.subject_id));
  return { service, institutionId, teachingTrack, classId, school, cycle,
    allowed, classLabel: classroom.label } as const;
}

async function readServices(context: Extract<Awaited<ReturnType<typeof scopedClass>>,
  { service: ReturnType<typeof getSupabaseServiceClient> }>) {
  const { service, institutionId, classId, allowed } = context;
  const allowedInstIds = allowed.map(row => row.id);
  if (!allowedInstIds.length) return { subjects: [], assignments: [], candidates: [] } as const;
  const [subjects, services, capabilities] = await Promise.all([
    service.from("subjects").select("id,name").in("id", allowed.map(x => x.subject_id)).limit(501),
    service.from("class_teachers").select("id,teacher_id,subject_id,class_id,start_date,end_date")
      .eq("institution_id", institutionId).eq("class_id", classId)
      .in("subject_id", allowedInstIds).is("end_date", null).limit(501),
    service.from("teacher_subjects").select("profile_id,subject_id")
      .eq("institution_id", institutionId)
      .in("subject_id", allowed.map(x => x.subject_id)).limit(1501),
  ]);
  if (subjects.error || services.error || capabilities.error ||
    (services.data || []).length >= 501 || (capabilities.data || []).length >= 1501)
    throw new Error("teaching_services_unavailable");
  const eligible = [...new Set((capabilities.data || []).map(x => x.profile_id))];
  const [roles, profiles] = eligible.length ? await Promise.all([
    service.from("user_roles").select("profile_id").eq("institution_id", institutionId)
      .eq("role", "teacher").in("profile_id", eligible),
    service.from("profiles").select("id,display_name")
      .eq("institution_id", institutionId).in("id", eligible),
  ]) : [{ data: [], error: null }, { data: [], error: null }];
  if (roles.error || profiles.error) throw new Error("teaching_candidates_unavailable");
  const legitimate = new Set((roles.data || []).map(x => x.profile_id));
  const names = new Map((profiles.data || []).map(x => [x.id, x.display_name || "Enseignant"]));
  const subjectNames = new Map((subjects.data || []).map(x => [x.id, x.name]));
  return {
    subjects: allowed.map(x => ({
      id: x.id, subjectId: x.subject_id, name: x.custom_name || subjectNames.get(x.subject_id) || "Discipline",
    })),
    assignments: (services.data || [] as Assignment[]).filter(x=>legitimate.has(x.teacher_id))
      .map(x=>({ ...x, teacherName: names.get(x.teacher_id) || "Enseignant" })),
    candidates: (capabilities.data || [] as TeacherRow[]).filter(x=>legitimate.has(x.profile_id))
      .map(x=>({ teacherId: x.profile_id, subjectId: x.subject_id,
        name: names.get(x.profile_id) || "Enseignant" })),
  };
}

export async function GET(req: NextRequest) {
  const context=await scopedClass(req.nextUrl.searchParams.get("class_id") || "");
  if ("error" in context) return context.error;
  try {
    return send({ ok:true, classLabel:context.classLabel, ...(await readServices(context)) });
  } catch {
    return send({ok:false,error:"teaching_services_unavailable"},503);
  }
}

export async function POST(req: NextRequest) {
  if (!validOrigin(req)) return send({ok:false,error:"invalid_origin"},403);
  if (!req.headers.get("content-type")?.includes("application/json"))
    return send({ok:false,error:"expected_json"},415);
  const body=await req.json().catch(()=>null);
  if (!body || !UUID.test(body.classId || "") || !UUID.test(body.teacherId || "") ||
      !UUID.test(body.institutionSubjectId || "")) return send({ok:false,error:"invalid_assignment"},400);
  const context=await scopedClass(body.classId);
  if ("error" in context) return context.error;
  const subject=context.allowed.find(x=>x.id===body.institutionSubjectId);
  if (!subject) return send({ok:false,error:"foreign_subject"},403);
  const {service,institutionId,classId}=context;
  const [grant, capability, previous]=await Promise.all([
    service.from("user_roles").select("profile_id").eq("institution_id",institutionId)
      .eq("profile_id",body.teacherId).eq("role","teacher").maybeSingle(),
    service.from("teacher_subjects").select("profile_id").eq("institution_id",institutionId)
      .eq("profile_id",body.teacherId).eq("subject_id",subject.subject_id).maybeSingle(),
    service.from("class_teachers").select("id").eq("institution_id",institutionId)
      .eq("class_id",classId).eq("subject_id",subject.id)
      .eq("teacher_id",body.teacherId).is("end_date",null).limit(1),
  ]);
  if (grant.error || capability.error || previous.error)
    return send({ok:false,error:"assignment_check_unavailable"},503);
  if (!grant.data || !capability.data) return send({ok:false,error:"teacher_not_qualified_for_subject"},403);
  if (previous.data?.length) return send({ok:false,error:"already_assigned"},409);
  const {data,error}=await service.from("class_teachers").insert({
    institution_id:institutionId,class_id:classId,subject_id:subject.id,
    teacher_id:body.teacherId,start_date:new Date().toISOString().slice(0,10),
  }).select("id").single();
  if (error || !data) return send({ok:false,error:"assignment_failed"},409);
  return send({ok:true,id:data.id},201);
}

export async function PATCH(req: NextRequest) {
  if (!validOrigin(req)) return send({ok:false,error:"invalid_origin"},403);
  if (!req.headers.get("content-type")?.includes("application/json"))
    return send({ok:false,error:"expected_json"},415);
  const body=await req.json().catch(()=>null);
  if (!body || !UUID.test(body.classId || "") || !UUID.test(body.assignmentId || ""))
    return send({ok:false,error:"invalid_assignment"},400);
  const context=await scopedClass(body.classId);
  if ("error" in context) return context.error;
  const {service,institutionId,classId}=context;
  const {data:assignment,error:lookupError}=await service.from("class_teachers")
    .select("id,subject_id,teacher_id").eq("id",body.assignmentId)
    .eq("institution_id",institutionId).eq("class_id",classId)
    .is("end_date",null).maybeSingle();
  if (lookupError) return send({ok:false,error:"assignment_load_failed"},503);
  if (!assignment || !context.allowed.some(x=>x.id===assignment.subject_id))
    return send({ok:false,error:"foreign_assignment"},403);
  const {data, error}=await service.from("class_teachers").update({
    end_date:new Date().toISOString().slice(0,10),
  }).eq("id",assignment.id).eq("class_id",classId)
    .eq("institution_id",institutionId).eq("subject_id",assignment.subject_id)
    .is("end_date",null).select("id");
  if (error || data?.length !== 1) return send({ok:false,error:"assignment_update_failed"},409);
  return send({ok:true});
}

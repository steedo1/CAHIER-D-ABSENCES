import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { parentConnectStatus, parentConnectMessage, type ParentConnectStatus } from "./domain";

type Service = ReturnType<typeof getSupabaseServiceClient>;
type Student = { id: string; institution_id: string | null };

export function parentConnectSchemaMissing(error: { code?: string; message?: string } | null) {
  return !!error && ["42P01", "PGRST205"].includes(String(error.code));
}

/** Only an absent migration or an unconfigured school keeps the previous access.
 * Network, permission and unexpected database errors never grant paid access. */
export async function getParentConnectStatuses(srv: Service, students: Student[]): Promise<Map<string, ParentConnectStatus>> {
  const result = new Map<string, ParentConnectStatus>();
  if (!students.length) return result;
  const institutionIds = [...new Set(students.map((s) => s.institution_id).filter(Boolean))] as string[];
  const settings = institutionIds.length
    ? await srv.from("parent_connect_school_settings").select("institution_id,enforcement_enabled,approved_academic_year,approved_ends_at").in("institution_id", institutionIds)
    : { data: [], error: null };
  if (settings.error && !parentConnectSchemaMissing(settings.error)) throw new Error("Parent Connect est momentanément indisponible.");
  const enforced = new Set((settings.data || []).filter((r) => r.enforcement_enabled === true).map((r) => String(r.institution_id)));
  const paidStudents = students.filter((s) => s.institution_id && enforced.has(s.institution_id));
  const paidInstitutions = [...new Set(paidStudents.map((s) => s.institution_id!))];
  const [accounts, years] = paidStudents.length ? await Promise.all([
    srv.from("parent_connect_accounts").select("student_id,institution_id,academic_year,ends_at").in("student_id", paidStudents.map((s) => s.id)),
    srv.from("academic_years").select("institution_id,code,end_date").in("institution_id", paidInstitutions).eq("is_current", true),
  ]) : [{ data: [], error: null }, { data: [], error: null }];
  if (accounts.error || years.error) throw new Error("Parent Connect est momentanément indisponible.");
  const currentYear = new Map<string, { code: string; end_date: string | null }>();
  for (const year of years.data || []) {
    if (currentYear.has(year.institution_id)) throw new Error("Année scolaire ambiguë.");
    currentYear.set(year.institution_id, year);
  }
  const approved = new Map((settings.data || []).map((r) => [r.institution_id, r]));
  const expiry = new Map((accounts.data || []).map((r) => [`${r.institution_id}:${r.student_id}:${r.academic_year}`, r.ends_at]));
  for (const student of students) {
    const year = currentYear.get(student.institution_id || "");
    const end = year?.end_date ? expiry.get(`${student.institution_id}:${student.id}:${year.code}`) : null;
    const boundary = year?.end_date ? Date.parse(`${year.end_date}T00:00:00Z`) + 86400_000 : NaN;
    const cfg = approved.get(student.institution_id || "");
    const limit = cfg?.approved_academic_year === year?.code && cfg?.approved_ends_at ? Date.parse(cfg.approved_ends_at) : NaN;
    const capped = end && Number.isFinite(boundary) && Number.isFinite(limit) ? new Date(Math.min(Date.parse(end), boundary, limit)).toISOString() : null;
    result.set(student.id, parentConnectStatus(enforced.has(student.institution_id || ""), capped));
  }
  return result;
}

export async function getParentConnectStatus(srv: Service, studentId: string) {
  const lookup = await srv.rpc("parent_connect_access_status", { p_student_id: studentId });
  if (!lookup.error) {
    if (!lookup.data) throw new Error("Parent Connect est momentanément indisponible.");
    return parentConnectStatus(lookup.data.enforced === true, lookup.data.ends_at);
  }
  // Compatibility before migration / while PostgREST refreshes its schema cache.
  if (!["PGRST202", "42883"].includes(String(lookup.error.code))) throw new Error("Parent Connect est momentanément indisponible.");
  const { data: student, error } = await srv.from("students").select("id,institution_id").eq("id", studentId).maybeSingle();
  if (error || !student) throw new Error("Parent Connect est momentanément indisponible.");
  return (await getParentConnectStatuses(srv, [student])).get(studentId)!;
}

/** Use only after the endpoint's existing ownership check. */
export async function parentConnectDenial(srv: Service, studentId: string) {
  try {
    const access = await getParentConnectStatus(srv, studentId);
    return access.allowed ? null : NextResponse.json({ error: parentConnectMessage(access), code: "PARENT_CONNECT_REQUIRED", parent_connect: access }, { status: 402, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Parent Connect est momentanément indisponible. Réessayez.", code: "PARENT_CONNECT_UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

export async function filterParentConnectStudentIds(srv: Service, ids: string[]) {
  if (!ids.length) return [];
  const { data, error } = await srv.from("students").select("id,institution_id").in("id", [...new Set(ids)]);
  if (error) throw new Error("Parent Connect est momentanément indisponible.");
  const statuses = await getParentConnectStatuses(srv, data || []);
  return ids.filter((id) => statuses.get(id)?.allowed);
}

type NotificationRow = { id?: string; student_id?: string | null; institution_id?: string | null; parent_id?: string | null; profile_id?: string | null; payload?: any; meta?: any };
function notificationObject(value: unknown): Record<string, any> {
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return {}; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}
export async function filterParentConnectNotifications<T extends NotificationRow>(srv: Service, rows: T[], ownedIds: string[] = [], ownedByRow?: Map<T, string[]>) {
  if (!rows.length) return rows;
  const studentId = (row: T) => {
    const payload = notificationObject(row.payload);
    return String(row.student_id || payload.student_id || payload.studentId || "");
  };
  const ids = [...new Set([...ownedIds, ...rows.map(studentId)].filter(Boolean))];
  const students = ids.length ? await srv.from("students").select("id,institution_id").in("id", ids) : { data: [], error: null };
  if (students.error) throw new Error("Parent Connect est momentanément indisponible.");
  const statuses = await getParentConnectStatuses(srv, students.data || []);
  const institutionIds = [...new Set(rows.map((r) => r.institution_id).filter(Boolean))] as string[];
  const settings = institutionIds.length ? await srv.from("parent_connect_school_settings").select("institution_id,enforcement_enabled").in("institution_id", institutionIds) : { data: [], error: null };
  if (settings.error && !parentConnectSchemaMissing(settings.error)) throw new Error("Parent Connect est momentanément indisponible.");
  const enforced = new Set((settings.data || []).filter((r) => r.enforcement_enabled).map((r) => r.institution_id));
  return rows.filter((r) => {
    const id = studentId(r);
    if (id) return statuses.get(id)?.allowed === true;
    const own = ownedByRow?.get(r) || ownedIds;
    if (!r.institution_id) return own.length ? own.some((sid) => statuses.get(sid)?.allowed) : true;
    if (!enforced.has(r.institution_id)) return true;
    return (students.data || []).some((s) => own.includes(s.id) && s.institution_id === r.institution_id && statuses.get(s.id)?.allowed);
  });
}

/** Only parent notifications are gated. Staff/founder deliveries keep their existing flow. */
export async function filterParentConnectQueue<T extends NotificationRow>(srv: Service, rows: T[]) {
  const profileIds = [...new Set(rows.map((r) => r.profile_id).filter(Boolean))] as string[];
  const deviceId = (r: T) => notificationObject(r.meta).device_id;
  const deviceIds = [...new Set(rows.map(deviceId).filter(Boolean))] as string[];
  const [parentRoles, devices] = await Promise.all([
    profileIds.length ? srv.from("user_roles").select("profile_id").eq("role", "parent").in("profile_id", profileIds) : { data: [], error: null },
    deviceIds.length ? srv.from("parent_devices").select("device_id,parent_profile_id").in("device_id", deviceIds) : { data: [], error: null },
  ]);
  if (parentRoles.error || devices.error) throw new Error("Parent Connect est momentanément indisponible.");
  const parentProfiles = new Set((parentRoles.data || []).map((r) => r.profile_id));
  const deviceParents = new Map((devices.data || []).map((r) => [r.device_id, r.parent_profile_id]));
  const parentId = (r: T) => String(r.parent_id || (parentProfiles.has(r.profile_id) ? r.profile_id : null) || deviceParents.get(deviceId(r)) || "");
  const isParent = (r: T) => {
    const payload = notificationObject(r.payload);
    const kind = String(payload.kind || payload.type || payload.event || "");
    if (kind.startsWith("founder_") || kind.startsWith("admin_")) return false;
    return !!parentId(r) || (!!r.student_id && !r.profile_id) || String(payload.url || "").startsWith("/parents");
  };
  const parents = rows.filter(isParent);
  if (!parents.length) return rows;
  const parentIds = [...new Set(parents.map(parentId).filter(Boolean))];
  const guardians: { student_id: string; parent_id: string | null; guardian_profile_id: string | null }[] = [];
  if (parentIds.length) for (let offset = 0; ; offset += 1000) {
    const response = await srv.from("student_guardians").select("student_id,parent_id,guardian_profile_id").or(`parent_id.in.(${parentIds.join(",")}),guardian_profile_id.in.(${parentIds.join(",")})`).order("id").range(offset, offset + 999);
    if (response.error) throw new Error("Parent Connect est momentanément indisponible.");
    guardians.push(...(response.data || []));
    if ((response.data || []).length < 1000) break;
  }
  // A generic message is evaluated against that recipient's children, never another parent's.
  const ownedByParent = new Map<string, string[]>();
  for (const g of guardians) for (const pid of [g.parent_id, g.guardian_profile_id]) {
    if (pid) ownedByParent.set(pid, [...(ownedByParent.get(pid) || []), g.student_id]);
  }
  const ownedByRow = new Map(parents.map((r) => [r, ownedByParent.get(parentId(r)) || []]));
  const ownedIds = [...new Set([...ownedByRow.values()].flat())];
  const allowed = new Set(await filterParentConnectNotifications(srv, parents, ownedIds, ownedByRow));
  return rows.filter((r) => !isParent(r) || allowed.has(r));
}

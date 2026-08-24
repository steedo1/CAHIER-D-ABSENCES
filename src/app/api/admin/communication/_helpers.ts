import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { getInstitutionSmsPolicy, isPushEnabled, isSmsPremiumEnabled, resolveSmsProvider } from "@/lib/sms/policy";
import { normalizePhone } from "@/lib/phone";
import { isEducationType } from "@/lib/education-organization";
import {
  ALL_EDUCATION_TYPES,
  classMatchesEducationScope,
  getClassLevelCode,
  normalizeClassEducationType,
  readEducationScopeFromRecord,
  type EducationScopedClass,
  type EducationScopeValue,
} from "@/lib/education-scope";

export const FIRST_CYCLE_LEVELS = new Set(["6e", "5e", "4e", "3e"]);
export const SECOND_CYCLE_LEVELS = new Set(["2nde", "seconde", "1re", "1ere", "premiere", "première", "tle", "terminale", "terminal"]);

export type CommunicationAudienceType = "parents" | "staff";
export type CommunicationChannel = "push" | "sms" | "push_sms";

export type CommunicationTarget = {
  audience_type: CommunicationAudienceType;
  target_type: string;
  target_value?: string | null;
  education_type?: string | null;
  formation_code?: string | null;
  formation_level_code?: string | null;
  class_id?: string | null;
};

type CommunicationClass = EducationScopedClass & {
  id: string;
  label: string;
  level: string;
  academic_year: string | null;
  head_teacher_id: string | null;
};

export type CommunicationRecipient = {
  profile_id: string;
  recipient_type: "parent" | "staff" | "teacher" | "head_teacher";
  display_name: string | null;
  phone_e164: string | null;
  related_student_ids: string[];
  roles: string[];
};

export type ResolveRecipientsResult = {
  recipients: CommunicationRecipient[];
  student_count: number;
  class_count: number;
  target_label: string;
};

const ADMIN_ROLES = new Set(["admin", "super_admin", "founder"]);
const STAFF_ROLE_EXCLUSIONS = new Set(["parent", "student", "class_device"]);

function s(value: unknown) {
  return String(value ?? "").trim();
}

function uniq(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((v) => s(v)).filter(Boolean)));
}

export function normalizeLevel(value: unknown): string {
  const raw = s(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "");

  if (["6", "6e", "6eme", "sixieme"].includes(raw) || /^6/.test(raw)) return "6e";
  if (["5", "5e", "5eme", "cinquieme"].includes(raw) || /^5/.test(raw)) return "5e";
  if (["4", "4e", "4eme", "quatrieme"].includes(raw) || /^4/.test(raw)) return "4e";
  if (["3", "3e", "3eme", "troisieme"].includes(raw) || /^3/.test(raw)) return "3e";
  if (["2", "2de", "2nde", "seconde"].includes(raw) || raw.startsWith("2de") || raw.startsWith("2nde") || /^2[a-z]/.test(raw)) return "2nde";
  if (["1", "1re", "1ere", "premiere", "premierea", "premiered"].includes(raw) || raw.startsWith("1re") || raw.startsWith("1ere") || /^1[a-z]/.test(raw)) return "1re";
  if (["t", "tle", "terminal", "terminale"].includes(raw) || raw.startsWith("tle") || raw.startsWith("term") || /^t[a-z]/.test(raw)) return "Terminale";

  return s(value);
}

function cycleForLevel(level: unknown): "first_cycle" | "second_cycle" | null {
  const normalized = normalizeLevel(level).toLowerCase();
  if (FIRST_CYCLE_LEVELS.has(normalized)) return "first_cycle";
  if (SECOND_CYCLE_LEVELS.has(normalized)) return "second_cycle";
  return null;
}

function communicationEducationScope(
  target: CommunicationTarget,
): EducationScopeValue {
  const hasScope = Boolean(
    s(target.education_type) ||
      s(target.formation_code) ||
      s(target.formation_level_code) ||
      s(target.class_id),
  );

  if (!hasScope) {
    return {
      educationType: ALL_EDUCATION_TYPES,
      formationCode: "",
      levelCode: "",
      classId: "",
    };
  }

  const rawEducationType = s(target.education_type);
  if (
    rawEducationType &&
    rawEducationType !== ALL_EDUCATION_TYPES &&
    !isEducationType(rawEducationType)
  ) {
    throw new Error("education_type_invalid");
  }

  const scope = readEducationScopeFromRecord({
    education_type: target.education_type,
    formation_code: target.formation_code,
    formation_level_code: target.formation_level_code,
    class_id: target.class_id,
  });

  if (
    scope.educationType !== ALL_EDUCATION_TYPES &&
    scope.educationType !== "general_secondary" &&
    !scope.formationCode
  ) {
    throw new Error("formation_required_for_education_type");
  }

  return scope;
}

async function getCurrentAcademicYear(
  srv: SupabaseClient,
  institutionId: string
): Promise<string | null> {
  const { data: current } = await srv
    .from("academic_years")
    .select("code")
    .eq("institution_id", institutionId)
    .eq("is_current", true)
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if ((current as any)?.code) return String((current as any).code);

  const { data: latest } = await srv
    .from("academic_years")
    .select("code")
    .eq("institution_id", institutionId)
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (latest as any)?.code ? String((latest as any).code) : null;
}

export async function requireCommunicationAdmin() {
  const supabase = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 }) } as const;
  }

  const [{ data: profile, error: profileErr }, { data: roleRows, error: roleErr }] = await Promise.all([
    supabase.from("profiles").select("institution_id").eq("id", user.id).maybeSingle(),
    srv.from("user_roles").select("role,institution_id").eq("profile_id", user.id),
  ]);

  if (profileErr) {
    return { error: NextResponse.json({ ok: false, error: profileErr.message }, { status: 400 }) } as const;
  }
  if (roleErr) {
    return { error: NextResponse.json({ ok: false, error: roleErr.message }, { status: 400 }) } as const;
  }

  const rows = Array.isArray(roleRows) ? roleRows : [];
  const roles = rows.map((row: any) => String(row.role || ""));
  const isAllowed = roles.some((role) => ADMIN_ROLES.has(role));

  if (!isAllowed) {
    return { error: NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 }) } as const;
  }

  let institutionId = s((profile as any)?.institution_id);
  if (!institutionId) {
    institutionId = s((rows.find((row: any) => row.institution_id) as any)?.institution_id);
  }

  if (!institutionId) {
    return { error: NextResponse.json({ ok: false, error: "no_institution" }, { status: 400 }) } as const;
  }

  return {
    srv,
    userId: user.id,
    institutionId,
    academicYear: await getCurrentAcademicYear(srv, institutionId),
  } as const;
}

export async function getCommunicationChannelState(
  srv: SupabaseClient,
  institutionId: string
) {
  const policy = await getInstitutionSmsPolicy(srv, institutionId);
  const smsProvider = resolveSmsProvider(policy);

  return {
    push_enabled: isPushEnabled(policy),
    sms_enabled: isSmsPremiumEnabled(policy) && smsProvider === "orange_ci" && policy.smsCommunicationEnabled !== false,
    sms_premium_enabled: isSmsPremiumEnabled(policy),
    sms_provider: smsProvider,
    sms_sender_name: policy.smsSenderName,
  };
}


export async function getCommunicationInstitution(
  srv: SupabaseClient,
  institutionId: string
) {
  const id = s(institutionId);
  if (!id) {
    return { id: "", name: null as string | null, acronym: null as string | null, display_name: "Mon Cahier" };
  }

  // Important : certaines bases Mon Cahier déjà déployées n'ont pas encore
  // de colonne `acronym` dans `institutions`. Pour le module Communication,
  // on n'a besoin que du nom officiel afin de signer les messages.
  // On évite donc de sélectionner une colonne optionnelle qui peut casser
  // toute la page avec l'erreur : column institutions.acronym does not exist.
  const { data, error } = await srv
    .from("institutions")
    .select("id,name")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(error.message);

  const name = s((data as any)?.name) || null;

  return {
    id,
    name,
    acronym: null as string | null,
    display_name: name || "Mon Cahier",
  };
}

export async function getCommunicationClasses(
  srv: SupabaseClient,
  institutionId: string,
  academicYear: string | null
) {
  let query = srv
    .from("classes")
    .select("id,label,level,academic_year,head_teacher_id,education_type,formation_code,formation_level_code")
    .eq("institution_id", institutionId);

  if (academicYear) query = query.eq("academic_year", academicYear);

  const { data, error } = await query
    .order("level", { ascending: true })
    .order("label", { ascending: true })
    .limit(1000);

  if (error) throw new Error(error.message);

  return (data || []).map((row: any) => ({
    id: String(row.id),
    label: s(row.label) || "Classe",
    level:
      normalizeClassEducationType(row) === "general_secondary"
        ? normalizeLevel(row.level)
        : getClassLevelCode(row),
    academic_year: row.academic_year ? String(row.academic_year) : null,
    head_teacher_id: row.head_teacher_id ? String(row.head_teacher_id) : null,
    education_type: row.education_type ?? null,
    formation_code: row.formation_code ?? null,
    formation_level_code: row.formation_level_code ?? null,
  })) as CommunicationClass[];
}

async function fetchPhonesByProfile(
  srv: SupabaseClient,
  profileIds: string[],
  institutionId: string
) {
  const out = new Map<string, string | null>();
  const ids = uniq(profileIds);
  if (!ids.length) return out;

  const { data: contacts } = await srv
    .from("parent_notification_contacts")
    .select("profile_id,institution_id,phone_e164,sms_enabled,is_primary,verified_at,created_at")
    .in("profile_id", ids)
    .eq("sms_enabled", true);

  const grouped = new Map<string, any[]>();
  for (const row of contacts || []) {
    const profileId = s((row as any).profile_id);
    if (!profileId) continue;
    const list = grouped.get(profileId) || [];
    list.push(row);
    grouped.set(profileId, list);
  }

  for (const [profileId, rows] of grouped.entries()) {
    rows.sort((a, b) => {
      const aExact = s(a.institution_id) === institutionId ? 1 : 0;
      const bExact = s(b.institution_id) === institutionId ? 1 : 0;
      if (aExact !== bExact) return bExact - aExact;

      const primary = Number(Boolean(b.is_primary)) - Number(Boolean(a.is_primary));
      if (primary !== 0) return primary;

      const verified = Number(Boolean(b.verified_at)) - Number(Boolean(a.verified_at));
      if (verified !== 0) return verified;

      return s(a.created_at).localeCompare(s(b.created_at));
    });

    const phone = normalizePhone(rows[0]?.phone_e164 || null);
    if (phone) out.set(profileId, phone);
  }

  const missing = ids.filter((id) => !out.has(id));
  if (missing.length) {
    const { data: profiles } = await srv
      .from("profiles")
      .select("id,phone")
      .in("id", missing);

    for (const row of profiles || []) {
      const profileId = s((row as any).id);
      if (!profileId) continue;
      out.set(profileId, normalizePhone((row as any).phone));
    }
  }

  return out;
}

async function fetchProfilePushAvailability(
  srv: SupabaseClient,
  profileIds: string[]
) {
  const ids = uniq(profileIds);
  const out = new Set<string>();
  if (!ids.length) return out;

  const { data, error } = await srv
    .from("push_subscriptions")
    .select("user_id")
    .in("user_id", ids);

  if (error) {
    console.warn("[communication] push_subscriptions lookup failed", {
      error: error.message,
    });
    return out;
  }

  for (const row of data || []) {
    const userId = s((row as any).user_id);
    if (userId) out.add(userId);
  }

  return out;
}

/**
 * Certains accès parents fonctionnent avec un appareil lié à l'élève
 * plutôt qu'avec un compte parent Supabase classique. Dans ce cas,
 * l'abonnement push est stocké dans push_subscriptions_student.
 * Pour le module Communication, un parent est donc "push prêt" si :
 * - son profil a un abonnement dans push_subscriptions ;
 * - OU l'un des élèves liés a un abonnement dans push_subscriptions_student.
 */
async function fetchStudentPushAvailability(
  srv: SupabaseClient,
  studentIds: string[]
) {
  const ids = uniq(studentIds);
  const out = new Set<string>();
  if (!ids.length) return out;

  try {
    const { data, error } = await srv
      .from("push_subscriptions_student")
      .select("student_id")
      .in("student_id", ids);

    if (error) {
      console.warn("[communication] push_subscriptions_student lookup failed", {
        error: error.message,
      });
      return out;
    }

    for (const row of data || []) {
      const studentId = s((row as any).student_id);
      if (studentId) out.add(studentId);
    }
  } catch (e: any) {
    console.warn("[communication] push_subscriptions_student lookup crashed", {
      error: String(e?.message || e),
    });
  }

  return out;
}

export async function enrichRecipientCapabilities(
  srv: SupabaseClient,
  institutionId: string,
  recipients: CommunicationRecipient[]
) {
  const profileIds = recipients.map((r) => r.profile_id);
  const studentIds = recipients.flatMap((r) => r.related_student_ids || []);
  const [phones, pushProfiles, pushStudents] = await Promise.all([
    fetchPhonesByProfile(srv, profileIds, institutionId),
    fetchProfilePushAvailability(srv, profileIds),
    fetchStudentPushAvailability(srv, studentIds),
  ]);

  return recipients.map((r) => {
    const hasProfilePush = pushProfiles.has(r.profile_id);
    const hasStudentPush = (r.related_student_ids || []).some((studentId) =>
      pushStudents.has(studentId)
    );

    return {
      ...r,
      phone_e164: phones.get(r.profile_id) || r.phone_e164 || null,
      has_push: hasProfilePush || hasStudentPush,
      has_sms_phone: Boolean(phones.get(r.profile_id) || r.phone_e164),
      push_source: hasProfilePush ? "profile" : hasStudentPush ? "student_device" : "none",
    };
  });
}

export async function resolveCommunicationRecipients(
  srv: SupabaseClient,
  institutionId: string,
  academicYear: string | null,
  target: CommunicationTarget
): Promise<ResolveRecipientsResult> {
  if (target.audience_type === "parents") {
    return resolveParentRecipients(srv, institutionId, academicYear, target);
  }
  return resolveStaffRecipients(srv, institutionId, academicYear, target);
}

async function resolveParentRecipients(
  srv: SupabaseClient,
  institutionId: string,
  academicYear: string | null,
  target: CommunicationTarget
): Promise<ResolveRecipientsResult> {
  const classes = await getCommunicationClasses(srv, institutionId, academicYear);
  const targetType = s(target.target_type) || "all";
  const targetValue = s(target.target_value);
  const educationScope = communicationEducationScope(target);

  if (
    targetType === "cycle" &&
    educationScope.educationType !== ALL_EDUCATION_TYPES &&
    educationScope.educationType !== "general_secondary"
  ) {
    throw new Error("cycle_general_secondary_only");
  }

  const selectedClasses = classes.filter((cls) => {
    if (!classMatchesEducationScope(cls, educationScope)) return false;
    if (targetType === "all") return true;
    if (targetType === "cycle") {
      return (
        normalizeClassEducationType(cls) === "general_secondary" &&
        cycleForLevel(cls.level) === targetValue
      );
    }
    if (targetType === "level") {
      return normalizeClassEducationType(cls) === "general_secondary"
        ? normalizeLevel(cls.level) === normalizeLevel(targetValue)
        : getClassLevelCode(cls) === targetValue;
    }
    if (targetType === "class") return cls.id === targetValue;
    return false;
  });

  const classIds = selectedClasses.map((cls) => cls.id);
  if (!classIds.length) {
    return {
      recipients: [],
      student_count: 0,
      class_count: 0,
      target_label: targetLabelFor(target, classes),
    };
  }

  const { data: enrollments, error: enrollErr } = await srv
    .from("class_enrollments")
    .select("student_id,class_id,end_date")
    .in("class_id", classIds)
    .is("end_date", null)
    .limit(20000);

  if (enrollErr) throw new Error(enrollErr.message);

  const studentIds = uniq((enrollments || []).map((row: any) => row.student_id));
  if (!studentIds.length) {
    return {
      recipients: [],
      student_count: 0,
      class_count: classIds.length,
      target_label: targetLabelFor(target, classes),
    };
  }

  const { data: links, error: linkErr } = await srv
    .from("student_guardians")
    .select("student_id,parent_id,notifications_enabled")
    .in("student_id", studentIds)
    .limit(50000);

  if (linkErr) throw new Error(linkErr.message);

  const parentIds = uniq(
    (links || [])
      .filter((row: any) => row.notifications_enabled !== false)
      .map((row: any) => row.parent_id)
  );

  const profileMap = await fetchProfilesById(srv, parentIds);
  const byParent = new Map<string, CommunicationRecipient>();

  for (const row of links || []) {
    if ((row as any).notifications_enabled === false) continue;

    const parentId = s((row as any).parent_id);
    const studentId = s((row as any).student_id);
    if (!parentId || !studentId) continue;

    const profile = profileMap.get(parentId) || null;
    const current = byParent.get(parentId) || {
      profile_id: parentId,
      recipient_type: "parent" as const,
      display_name: profile?.display_name || profile?.email || "Parent",
      phone_e164: normalizePhone(profile?.phone || null),
      related_student_ids: [],
      roles: ["parent"],
    };

    current.related_student_ids = uniq([...current.related_student_ids, studentId]);
    byParent.set(parentId, current);
  }

  return {
    recipients: Array.from(byParent.values()).sort((a, b) => s(a.display_name).localeCompare(s(b.display_name))),
    student_count: studentIds.length,
    class_count: classIds.length,
    target_label: targetLabelFor(target, classes),
  };
}

async function resolveStaffRecipients(
  srv: SupabaseClient,
  institutionId: string,
  academicYear: string | null,
  target: CommunicationTarget
): Promise<ResolveRecipientsResult> {
  const targetType = s(target.target_type) || "staff_all";
  let profileIds: string[] = [];
  const rolesByProfile = new Map<string, string[]>();

  if (targetType === "head_teachers") {
    const classes = await getCommunicationClasses(srv, institutionId, academicYear);
    profileIds = uniq(classes.map((cls) => cls.head_teacher_id));
    for (const id of profileIds) rolesByProfile.set(id, ["teacher", "head_teacher"]);
  } else {
    let roleQuery = srv
      .from("user_roles")
      .select("profile_id,role")
      .eq("institution_id", institutionId)
      .limit(5000);

    if (targetType === "teachers") {
      roleQuery = roleQuery.eq("role", "teacher");
    }

    const { data: roleRows, error: roleErr } = await roleQuery;
    if (roleErr) throw new Error(roleErr.message);

    for (const row of roleRows || []) {
      const profileId = s((row as any).profile_id);
      const role = s((row as any).role);
      if (!profileId || !role) continue;
      if (targetType === "staff_all" && STAFF_ROLE_EXCLUSIONS.has(role)) continue;
      if (role === "super_admin" || role === "drenaet_admin") continue;

      const roles = rolesByProfile.get(profileId) || [];
      roles.push(role);
      rolesByProfile.set(profileId, uniq(roles));
    }

    profileIds = Array.from(rolesByProfile.keys());
  }

  const profileMap = await fetchProfilesById(srv, profileIds);
  const recipients: CommunicationRecipient[] = profileIds
    .map((profileId) => {
      const profile = profileMap.get(profileId) || null;
      const roles = rolesByProfile.get(profileId) || [];
      const isHeadTeacher = roles.includes("head_teacher");
      const recipientType: CommunicationRecipient["recipient_type"] = isHeadTeacher
        ? "head_teacher"
        : roles.includes("teacher")
          ? "teacher"
          : "staff";
      return {
        profile_id: profileId,
        recipient_type: recipientType,
        display_name: profile?.display_name || profile?.email || "Personnel",
        phone_e164: normalizePhone(profile?.phone || null),
        related_student_ids: [],
        roles,
      };
    })
    .sort((a, b) => s(a.display_name).localeCompare(s(b.display_name)));

  return {
    recipients,
    student_count: 0,
    class_count: 0,
    target_label: targetLabelFor(target, []),
  };
}

async function fetchProfilesById(srv: SupabaseClient, profileIds: string[]) {
  const out = new Map<string, { id: string; display_name: string | null; email: string | null; phone: string | null }>();
  const ids = uniq(profileIds);
  if (!ids.length) return out;

  const { data, error } = await srv
    .from("profiles")
    .select("id,display_name,email,phone")
    .in("id", ids)
    .limit(10000);

  if (error) throw new Error(error.message);

  for (const row of data || []) {
    const id = s((row as any).id);
    if (!id) continue;
    out.set(id, {
      id,
      display_name: (row as any).display_name ?? null,
      email: (row as any).email ?? null,
      phone: (row as any).phone ?? null,
    });
  }

  return out;
}

function communicationContextLabel(target: CommunicationTarget) {
  const scope = communicationEducationScope(target);
  if (scope.educationType === ALL_EDUCATION_TYPES) return "";

  const typeLabel =
    scope.educationType === "technical_secondary"
      ? "enseignement technique secondaire"
      : scope.educationType === "vocational_training"
        ? "formation professionnelle"
        : scope.educationType === "higher_technical_short_cycle"
          ? "enseignement supérieur technique court"
          : "secondaire général";
  const formation = scope.formationCode ? ` • ${scope.formationCode}` : "";
  return `${typeLabel}${formation}`;
}

export function targetLabelFor(
  target: CommunicationTarget,
  classes: Array<{ id: string; label: string; level: string }>,
) {
  const targetType = s(target.target_type) || "all";
  const targetValue = s(target.target_value);

  if (target.audience_type === "staff") {
    if (targetType === "teachers") return "Enseignants uniquement";
    if (targetType === "head_teachers") return "Professeurs principaux uniquement";
    return "Tout le personnel";
  }

  if (targetType === "cycle") {
    return targetValue === "second_cycle" ? "Parents du second cycle" : "Parents du premier cycle";
  }
  if (targetType === "level") {
    const contextLabel = communicationContextLabel(target);
    return contextLabel
      ? `Parents du niveau ${targetValue} — ${contextLabel}`
      : `Parents du niveau ${targetValue}`;
  }
  if (targetType === "class") {
    const cls = classes.find((item) => item.id === targetValue);
    return cls ? `Parents de la classe ${cls.label}` : "Parents d’une classe";
  }
  const contextLabel = communicationContextLabel(target);
  return contextLabel ? `Tous les parents — ${contextLabel}` : "Tous les parents";
}

export function summarizeRecipients(recipients: Array<CommunicationRecipient & { has_push?: boolean; has_sms_phone?: boolean }>) {
  return {
    recipient_count: recipients.length,
    push_ready_count: recipients.filter((r) => r.has_push).length,
    sms_ready_count: recipients.filter((r) => r.has_sms_phone).length,
  };
}

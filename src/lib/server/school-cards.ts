import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { getRequestRoles, requireInstitutionRole } from "@/lib/auth/server-context";
import { educatorNeedsAssignedClasses, educatorAssignmentCoversClass, loadEducatorAssignments } from "@/lib/auth/educator-class-scope";
import { CARD_READ_ROLES, CARD_WRITE_ROLES, CARD_SLOTS, defaultCardConfiguration, cardWarnings, signatureSlotForTracks, type CardConfiguration, type SchoolCard, type CardSlot, type CardAsset } from "@/lib/school-cards";
import { parseSchoolCyclesSettings, resolveSchoolCycleForClass } from "@/lib/school-cycles";
import { readStudentProgramSettings, programsForStudent, isBilingualSchool } from "@/lib/school-student-programs";
import { readSchoolTeachingSignatories } from "@/lib/school-teaching-signatories";
import { issueCardToken, cardFingerprint } from "@/lib/school-card-token";

export const cardJson = (body: unknown, status = 200) => NextResponse.json(body, { status,
  headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" } });
export const cardFeatureEnabled = () => process.env.SCHOOL_CARDS_ENABLED === "true";
export function requireCardOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  return (!origin || origin === req.nextUrl.origin) && !["cross-site"].includes(req.headers.get("sec-fetch-site") || "");
}
export async function cardScope(write = false) {
  if (!cardFeatureEnabled()) return { error: cardJson({ error: "module_non_active" }, 404) } as const;
  const client = await getSupabaseServerClient(), service = getSupabaseServiceClient();
  const access = await requireInstitutionRole(client, service, write ? CARD_WRITE_ROLES : CARD_READ_ROLES);
  if ("error" in access) return { error: cardJson({ error: access.error }, access.error === "unauthorized" ? 401 : 403) } as const;
  const roles = await getRequestRoles(client, service, access.user.id);
  const applicableRoles = (roles.data || []).filter(row => !row.institution_id || row.institution_id === access.instId || row.role === "super_admin").map(row => row.role);
  const [school, stored] = await Promise.all([
    service.from("institutions").select("id,name,phone,logo_url,head_name,head_title,country_name,country_motto,ministry_name,settings_json,subscription_expires_at").eq("id", access.instId).single(),
    service.from("school_card_settings").select("configuration,revision").eq("institution_id", access.instId).maybeSingle(),
  ]);
  if (school.error || stored.error) return { error: cardJson({ error: "configuration_cartes_indisponible" }, 503) } as const;
  const configuration: CardConfiguration = stored.data?.configuration || defaultCardConfiguration();
  return { ...access, service, school: school.data, configuration, revision: stored.data?.revision || 0,
    canConfigure: applicableRoles.some(role => (CARD_WRITE_ROLES as readonly string[]).includes(role)),
    educatorAssignments: educatorNeedsAssignedClasses(applicableRoles) ? await loadEducatorAssignments(service, access.instId, access.user.id) : null };
}
export type CardScope = Exclude<Awaited<ReturnType<typeof cardScope>>, { error: unknown }>;
export function publicCardConfig(configuration: CardConfiguration): CardConfiguration {
  // Never send private object locators to the browser. Asset presence only.
  return { ...configuration, signatures: Object.fromEntries(Object.entries(configuration.signatures || {}).map(([slot, asset]) => [slot, { original: "", processed: "", updatedAt: asset!.updatedAt }])) };
}
export async function loadCardClasses(ctx: CardScope, year: string) {
  const { data, error } = await ctx.service.from("classes").select("id,label,level,academic_year,education_type")
    .eq("institution_id", ctx.instId).eq("academic_year", year).order("id");
  if (error) throw Error("classes_unavailable");
  return (data || []).filter(row => !ctx.educatorAssignments || educatorAssignmentCoversClass(row, ctx.educatorAssignments));
}
export async function loadCardEnrollments(ctx: CardScope, year: string, options: { offset?: number; enrollmentIds?: string[] } = {}) {
  const classes = await loadCardClasses(ctx, year);
  if (!classes.length) return { items: [] as SchoolCard[], classes, nextOffset: null };
  let query = ctx.service.from("class_enrollments").select("id,student_id,class_id,start_date,end_date,students:student_id!inner(id,institution_id,full_name,first_name,last_name,matricule,birthdate,birth_place,gender,photo_path,lifecycle_status)")
    .eq("institution_id", ctx.instId).is("end_date", null).in("class_id", classes.map(row => row.id))
    .eq("students.institution_id", ctx.instId).order("id");
  if (options.enrollmentIds) query = query.in("id", options.enrollmentIds);
  else query = query.range(options.offset || 0, (options.offset || 0) + 499);
  const { data, error } = await query;
  if (error) throw Error("roster_unavailable");
  const rows = (data || []).filter((row: any) => (!row.students.lifecycle_status || row.students.lifecycle_status === "active") &&
    row.start_date && Date.parse(row.start_date + "T00:00:00Z") <= Date.now());
  const revocations = new Set<string>();
  for (let start = 0; start < rows.length; start += 100) {
    const revoked = await ctx.service.from("school_card_revocations").select("enrollment_id,revoked")
      .eq("institution_id", ctx.instId).in("enrollment_id", rows.slice(start,start+100).map(row => row.id));
    if (revoked.error) throw Error("revocations_unavailable");
    (revoked.data || []).filter(row => row.revoked).forEach(row => revocations.add(row.enrollment_id));
  }
  const paths = [...new Set(rows.map((row: any) => row.students.photo_path as string)
    .filter((path, i) => path?.startsWith(`${ctx.instId}/${rows[i].student_id}/`)))];
  const photos = new Map<string, string>();
  if (paths.length) {
    const signed = await ctx.service.storage.from("student-photos").createSignedUrls(paths, 1800);
    if (signed.error) throw Error("photos_unavailable");
    (signed.data || []).forEach(row => { if (row.path && row.signedUrl) photos.set(row.path, row.signedUrl); });
  }
  const cycles = parseSchoolCyclesSettings(ctx.school.settings_json), programs = readStudentProgramSettings(ctx.school.settings_json);
  const byClass = new Map(classes.map(row => [row.id, row]));
  const items: SchoolCard[] = rows.map((row: any) => {
    const student = row.students, classe = byClass.get(row.class_id)!;
    const cycle = resolveSchoolCycleForClass(classe, cycles);
    const item: SchoolCard = { enrollmentId: row.id, studentId: row.student_id, classId: row.class_id, year,
      name: student.full_name || [student.last_name, student.first_name].filter(Boolean).join(" "), matricule: student.matricule || "",
      birthdate: student.birthdate || "", birthPlace: student.birth_place || "", gender: student.gender || "",
      classLabel: classe.label, level: classe.level || "", photoUrl: photos.get(student.photo_path) || null,
      tracks: programsForStudent(programs.years[year]?.classes[row.class_id], row.student_id, cycles.teachingTracksByCycle[cycle] || []),
      revoked: revocations.has(row.id), warnings: [] };
    item.warnings = cardWarnings(item); return item;
  });
  return { items, classes, nextOffset: !options.enrollmentIds && data?.length === 500 ? (options.offset || 0) + 500 : null };
}
export async function cardSignatureImages(ctx: CardScope) {
  const images: Partial<Record<CardSlot, string>> = {};
  if (!ctx.configuration.automaticSignature) return images;
  for (const slot of CARD_SLOTS) {
    const asset = ctx.configuration.signatures?.[slot];
    if (!asset || !safeCardAsset(ctx.instId, asset)) continue;
    const blob = await ctx.service.storage.from("signatures").download(asset.processed);
    if (blob.error || !blob.data) throw Error("signature_unavailable");
    images[slot] = `data:image/png;base64,${Buffer.from(await blob.data.arrayBuffer()).toString("base64")}`;
  }
  return images;
}
export function safeCardAsset(instId: string, asset: CardAsset) {
  const prefix = `school-cards/${instId}/`;
  return asset.original.startsWith(prefix) && asset.processed.startsWith(prefix) && ![asset.original,asset.processed].some(path => path.includes(".."));
}
export function prepareSchoolCards(ctx: CardScope, items: SchoolCard[], origin: string) {
  const cycles = parseSchoolCyclesSettings(ctx.school.settings_json), bilingual = isBilingualSchool(cycles);
  const signatories = readSchoolTeachingSignatories(ctx.school.settings_json);
  return items.map(item => {
    const slot = signatureSlotForTracks(item.tracks, bilingual);
    const signatoryName = slot === "general" ? ctx.school.head_name || "" : slot ? signatories[slot]?.name || "" : "";
    // Bilingual images require a configured teaching director; no general fallback.
    const signatureSlot = ctx.configuration.automaticSignature && slot && signatoryName && ctx.configuration.signatures?.[slot] ? slot : null;
    const token = issueCardToken({ institutionId: ctx.instId, studentId: item.studentId, enrollmentId: item.enrollmentId, classId: item.classId, year: item.year });
    return { ...item, token, verificationUrl: `${origin}/verifier-carte#${token}`, fingerprint: cardFingerprint(token), signatureSlot, signatoryName,
      warnings: ctx.configuration.automaticSignature && !signatureSlot ? [...item.warnings, "Signature non appliquée : responsable ou section à configurer"] : item.warnings };
  });
}
export async function readCardYears(service: SupabaseClient, institutionId: string) {
  const result = await service.from("academic_years").select("code,start_date,end_date,is_current").eq("institution_id", institutionId).order("start_date", { ascending: false });
  if (result.error) throw Error("years_unavailable");
  return result.data || [];
}
export function isCardYearValid(year: { start_date: string; end_date: string; is_current: boolean } | undefined, now = Date.now()) {
  return !!year && year.is_current === true && !!year.start_date && !!year.end_date &&
    Date.parse(year.start_date + "T00:00:00Z") <= now && Date.parse(year.end_date + "T23:59:59.999Z") >= now;
}

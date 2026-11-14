import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { getRequestRoles, requireInstitutionRole } from "@/lib/auth/server-context";
import { educatorNeedsAssignedClasses, educatorAssignmentCoversClass, loadEducatorAssignments } from "@/lib/auth/educator-class-scope";
import { CARD_READ_ROLES, CARD_WRITE_ROLES, CARD_SLOTS, defaultCardConfiguration, cardWarnings, signatureSlotForTracks, cardTeachingTrackForClass, usesEpcSchoolCardLayout, type CardConfiguration, type SchoolCard, type CardSlot, type CardAsset } from "@/lib/school-cards";
import { parseSchoolCyclesSettings, resolveSchoolCycleForClass } from "@/lib/school-cycles";
import { readStudentProgramSettings, programsForStudent, isBilingualSchool, expandPedagogicalEnrollments } from "@/lib/school-student-programs";
import { readSchoolTeachingSignatories } from "@/lib/school-teaching-signatories";
import { issueCardToken, cardFingerprint } from "@/lib/school-card-token";
import { isTrustedAppOrigin } from "@/lib/request-origin";

export const cardJson = (body: unknown, status = 200) => NextResponse.json(body, { status,
  headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" } });
export const cardFeatureEnabled = () => process.env.SCHOOL_CARDS_ENABLED === "true";
export function requireCardOrigin(req: NextRequest) {
  return isTrustedAppOrigin(req, [process.env.SCHOOL_CARD_PUBLIC_ORIGIN || "", process.env.NEXT_PUBLIC_APP_URL || "", process.env.PUBLIC_APP_URL || "", process.env.APP_URL || ""]) &&
    req.headers.get("sec-fetch-site") !== "cross-site";
}
export async function cardScope(write = false) {
  if (!cardFeatureEnabled()) return { error: cardJson({ error: "module_non_active" }, 404) } as const;
  const client = await getSupabaseServerClient(), service = getSupabaseServiceClient();
  const access = await requireInstitutionRole(client, service, write ? CARD_WRITE_ROLES : CARD_READ_ROLES);
  if ("error" in access) return { error: cardJson({ error: access.error }, access.error === "unauthorized" ? 401 : 403) } as const;
  const roles = await getRequestRoles(client, service, access.user.id);
  const applicableRoles = (roles.data || []).filter(row => !row.institution_id || row.institution_id === access.instId || row.role === "super_admin").map(row => row.role);
  const [school, stored] = await Promise.all([
    service.from("institutions").select("id,code,name,phone,logo_url,head_name,head_title,country_name,country_motto,ministry_name,settings_json,subscription_expires_at").eq("id", access.instId).single(),
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
  const masked = (assets: CardConfiguration["signatures"]) =>
    Object.fromEntries(Object.entries(assets || {}).map(([slot, asset]) =>
      [slot, { original: "", processed: "", updatedAt: asset!.updatedAt }]));
  return { ...configuration, signatures: masked(configuration.signatures), stamps: masked(configuration.stamps || {}) };
}
export async function loadCardClasses(ctx: CardScope, year: string) {
  const { data, error } = await ctx.service.from("classes").select("id,label,level,academic_year,education_type")
    .eq("institution_id", ctx.instId).eq("academic_year", year).order("id");
  if (error) throw Error("classes_unavailable");
  return data || [];
}
export async function loadCardEnrollments(ctx: CardScope, year: string, options: { offset?: number; enrollmentIds?: string[] } = {}) {
  const allClasses = await loadCardClasses(ctx, year);
  const classes = allClasses.filter(row => !ctx.educatorAssignments || educatorAssignmentCoversClass(row, ctx.educatorAssignments));
  if (!classes.length) return { items: [] as SchoolCard[], classes, nextOffset: null };
  const cycles = parseSchoolCyclesSettings(ctx.school.settings_json);
  const policy = readStudentProgramSettings(ctx.school.settings_json).years[year];
  const includeLinks = Object.values(policy?.classes || {}).some(classe => classe.linkedStudentIds?.length);
  const enrollmentClasses = includeLinks ? allClasses : classes;
  let query = ctx.service.from("class_enrollments").select("id,student_id,class_id,start_date,end_date,students:student_id!inner(id,institution_id,full_name,full_name_ar,first_name,last_name,matricule,birthdate,birth_place,gender,photo_path,lifecycle_status)")
    .eq("institution_id", ctx.instId).is("end_date", null).in("class_id", enrollmentClasses.map(row => row.id))
    .eq("students.institution_id", ctx.instId).order("id");
  if (options.enrollmentIds) query = query.in("id", options.enrollmentIds);
  else query = query.range(options.offset || 0, (options.offset || 0) + 499);
  const { data, error } = await query;
  if (error) throw Error("roster_unavailable");
  type EnrollmentStudent = NonNullable<NonNullable<typeof data>[number]["students"]>[number];
  type CardEnrollment = Omit<NonNullable<typeof data>[number], "students"> & { students: EnrollmentStudent };
  // The student_id foreign key embeds a single student in PostgREST.
  const rows = ((data || []) as unknown as CardEnrollment[]).filter(row =>
    (!row.students.lifecycle_status || row.students.lifecycle_status === "active") &&
    row.start_date && Date.parse(row.start_date + "T00:00:00Z") <= Date.now());
  const byClass = new Map(enrollmentClasses.map(row => [row.id, {
    ...row, cycle: resolveSchoolCycleForClass(row, cycles),
  }]));
  const permittedClasses = new Set(classes.map(row => row.id));
  const classIdsByStudent = new Map<string, string[]>();
  if (includeLinks) {
    for (const membership of expandPedagogicalEnrollments(cycles, policy, [...byClass.values()], rows)) {
      const classIds = classIdsByStudent.get(membership.student_id) ?? [];
      classIds.push(membership.class_id);
      classIdsByStudent.set(membership.student_id, classIds);
    }
  }
  // A pupil is in scope when any of their verified classes is assigned to the educator.
  const visibleRows = rows.filter(row => permittedClasses.has(row.class_id) ||
    classIdsByStudent.get(row.student_id)?.some(id => permittedClasses.has(id)));
  const revocations = new Set<string>();
  for (let start = 0; start < visibleRows.length; start += 100) {
    const revoked = await ctx.service.from("school_card_revocations").select("enrollment_id,revoked")
      .eq("institution_id", ctx.instId).in("enrollment_id", visibleRows.slice(start,start+100).map(row => row.id));
    if (revoked.error) throw Error("revocations_unavailable");
    (revoked.data || []).filter(row => row.revoked).forEach(row => revocations.add(row.enrollment_id));
  }
  const paths = [...new Set(visibleRows.flatMap(row => {
    const path = row.students.photo_path;
    return typeof path === "string" && path.startsWith(`${ctx.instId}/${row.student_id}/`) ? [path] : [];
  }))];
  const photos = new Map<string, string>();
  if (paths.length) {
    const signed = await ctx.service.storage.from("student-photos").createSignedUrls(paths, 1800);
    if (signed.error) throw Error("photos_unavailable");
    (signed.data || []).forEach(row => { if (row.path && row.signedUrl) photos.set(row.path, row.signedUrl); });
  }
  const items: SchoolCard[] = visibleRows.map(row => {
    const student = row.students;
    const home = byClass.get(row.class_id)!;
    const homePolicy = policy?.classes[home.id];
    const tracks = programsForStudent(homePolicy, row.student_id, cycles.teachingTracksByCycle[home.cycle] || []);
    const cardTrack = cardTeachingTrackForClass(tracks, homePolicy?.tracks || []);
    const classIds = classIdsByStudent.get(row.student_id) ?? [home.id];
    const teachingClasses = classIds.map(id => {
      const classe = byClass.get(id)!;
      const classTracks = policy?.classes[id]?.tracks ?? [];
      return { id, label: classe.label, level: classe.level || "",
        track: id === home.id ? cardTrack : cardTeachingTrackForClass(classTracks, classTracks) };
    });
    const orderedClasses = [
      ...teachingClasses.filter(classe => classe.track === "french"),
      ...teachingClasses.filter(classe => classe.track !== "french"),
    ];
    const arabicOnly = cardTrack === "arabic" && !orderedClasses.some(classe => classe.track === "french");
    const name = (arabicOnly ? student.full_name_ar?.trim() : "") ||
      student.full_name || [student.last_name, student.first_name].filter(Boolean).join(" ");
    const item: SchoolCard = { enrollmentId: row.id, studentId: row.student_id, classId: home.id, year,
      name, matricule: student.matricule || "", birthdate: student.birthdate || "", birthPlace: student.birth_place || "",
      gender: student.gender || "", classLabel: home.label, level: home.level || "", classes: orderedClasses,
      photoUrl: photos.get(student.photo_path) || null, tracks, cardTrack, revoked: revocations.has(row.id), warnings: [] };
    item.warnings = cardWarnings(item);
    return item;
  });
  return { items, classes, nextOffset: !options.enrollmentIds && data?.length === 500 ? (options.offset || 0) + 500 : null };
}
async function cardAssetImages(ctx: CardScope, kind: "signatures" | "stamps", slots: ReadonlySet<CardSlot>) {
  const images: Partial<Record<CardSlot, string>> = {};
  if (!ctx.configuration.automaticSignature) return images;
  const configured: Partial<Record<CardSlot, CardAsset>> = ctx.configuration[kind] || {};
  for (const slot of CARD_SLOTS) {
    if (!slots.has(slot)) continue;
    const asset = configured[slot];
    if (!asset || !safeCardAsset(ctx.instId, asset)) continue;
    const blob = await ctx.service.storage.from("signatures").download(asset.processed);
    if (blob.error || !blob.data) throw Error("card_asset_unavailable");
    images[slot] = `data:image/png;base64,${Buffer.from(await blob.data.arrayBuffer()).toString("base64")}`;
  }
  return images;
}
export const cardSignatureImages = (ctx: CardScope, slots: ReadonlySet<CardSlot>) => cardAssetImages(ctx, "signatures", slots);
export const cardStampImages = (ctx: CardScope, slots: ReadonlySet<CardSlot>) => cardAssetImages(ctx, "stamps", slots);
export function safeCardAsset(instId: string, asset: CardAsset) {
  const prefix = `school-cards/${instId}/`;
  return asset.original.startsWith(prefix) && asset.processed.startsWith(prefix) && ![asset.original,asset.processed].some(path => path.includes(".."));
}
export function prepareSchoolCards(ctx: CardScope, items: SchoolCard[], origin: string) {
  const cycles = parseSchoolCyclesSettings(ctx.school.settings_json), bilingual = isBilingualSchool(cycles);
  const signatories = readSchoolTeachingSignatories(ctx.school.settings_json);
  const epc = usesEpcSchoolCardLayout(ctx.school);
  const schoolSignatory = ctx.school.head_name && (ctx.configuration.signatures?.general || ctx.configuration.stamps?.general);
  return items.map(item => {
    const selectedTracks = item.cardTrack === undefined ? item.tracks : item.cardTrack ? [item.cardTrack] : [];
    const slot = epc ? "arabic" : schoolSignatory ? "general" : signatureSlotForTracks(selectedTracks, bilingual);
    const signatoryName = slot === "general" ? ctx.school.head_name || "" : slot ? signatories[slot]?.name || "" : "";
    const signatureSlot = ctx.configuration.automaticSignature && slot && signatoryName &&
      (ctx.configuration.signatures?.[slot] || ctx.configuration.stamps?.[slot]) ? slot : null;
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

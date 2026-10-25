import type { NextRequest } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { openCardToken, cardFingerprint, createCardScanLimiter } from "@/lib/school-card-token";
import { cardJson, cardFeatureEnabled, requireCardOrigin, isCardYearValid } from "@/lib/server/school-cards";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const allow = createCardScanLimiter();
export async function POST(req: NextRequest) {
  if (!cardFeatureEnabled()) return cardJson({ error: "verification_indisponible" }, 503);
  if (!requireCardOrigin(req)) return cardJson({ error: "origine_invalide" }, 403);
  if (Number(req.headers.get("content-length") || 0) > 1000) return cardJson({ valid: false }, 400);
  const body = await req.json().catch(() => null), token = body?.token;
  // Render sets X-Forwarded-For; use the rightmost (proxy appended) entry.
  const ip = (req.headers.get("x-forwarded-for") || "unknown").split(",").at(-1)!.trim();
  if (!allow(ip, typeof token === "string" ? token.slice(0, 200) : "")) {
    const response = cardJson({ error: "trop_de_verifications_reessayer_dans_une_minute" }, 429); response.headers.set("Retry-After", "60"); return response;
  }
  const payload = openCardToken(token);
  if (!payload) return cardJson({ valid: false }); // no SQL for forged tokens
  try {
    const service = getSupabaseServiceClient();
    const [enrollment, year, school, configuration, revocation] = await Promise.all([
      service.from("class_enrollments").select("id,start_date,end_date,students:student_id!inner(institution_id,lifecycle_status),classes:class_id!inner(institution_id,academic_year)")
        .eq("institution_id", payload.institutionId).eq("id", payload.enrollmentId).eq("student_id", payload.studentId).eq("class_id", payload.classId).maybeSingle(),
      service.from("academic_years").select("start_date,end_date,is_current").eq("institution_id", payload.institutionId).eq("code", payload.year).maybeSingle(),
      service.from("institutions").select("name,subscription_expires_at").eq("id", payload.institutionId).maybeSingle(),
      service.from("school_card_settings").select("configuration").eq("institution_id", payload.institutionId).maybeSingle(),
      service.from("school_card_revocations").select("revoked").eq("institution_id", payload.institutionId).eq("enrollment_id", payload.enrollmentId).maybeSingle(),
    ]);
    if ([enrollment, year, school, configuration, revocation].some(result => result.error)) return cardJson({ error: "verification_temporairement_indisponible" }, 503);
    const row = enrollment.data as any;
    const valid = !!row && !row.end_date && Date.parse(row.start_date + "T00:00:00Z") <= Date.now() &&
      row.students?.institution_id === payload.institutionId && (!row.students.lifecycle_status || row.students.lifecycle_status === "active") &&
      row.classes?.institution_id === payload.institutionId && row.classes.academic_year === payload.year &&
      isCardYearValid(year.data || undefined) && !!school.data &&
      (!school.data.subscription_expires_at || Date.parse(school.data.subscription_expires_at + "T23:59:59Z") >= Date.now()) &&
      configuration.data?.configuration?.enabled !== false && revocation.data?.revoked !== true;
    return cardJson(valid ? { valid: true, school: school.data!.name, year: payload.year, reference: cardFingerprint(token) } : { valid: false });
  } catch { return cardJson({ error: "verification_temporairement_indisponible" }, 503); }
}

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { GET as getBulletin } from "@/app/api/admin/grades/bulletin/route";
import { GET as getDashboard } from "@/app/api/admin/dashboard/metrics/route";
import { converse, conversationError, validateConversation } from "@/lib/mon-cahier-ai/conversation";
import { createSchoolReader } from "@/lib/mon-cahier-ai/school-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 150;

const limits = new Map<string, number[]>();
function allowRequest(key: string) {
  const now = Date.now();
  if (limits.size > 2000) for (const [id, times] of limits) if (!times.some(t => t > now - 3_600_000)) limits.delete(id);
  const recent = (limits.get(key) || []).filter(t => t > now - 3_600_000);
  if (recent.length >= 60 || recent.filter(t => t > now - 60_000).length >= 8) return false;
  limits.set(key, [...recent, now]); return true;
}

export async function POST(req: NextRequest) {
  const supa = await getSupabaseServerClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const { data: profile, error: profileError } = await supa.from("profiles").select("institution_id").eq("id", user.id).maybeSingle();
  if (profileError || !profile?.institution_id) return NextResponse.json({ ok: false, error: "no_institution" }, { status: 403 });
  const institutionId = String(profile.institution_id);
  const { data: role, error: roleError } = await supa.from("user_roles").select("role")
    .eq("profile_id", user.id).eq("institution_id", institutionId).in("role", ["admin", "super_admin", "educator"]).limit(1).maybeSingle();
  if (roleError || !role) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  let body: Record<string, any>;
  let messages;
  try {
    const text = await req.text();
    if (text.length > 35000) throw new Error("request_too_large");
    body = JSON.parse(text);
    messages = validateConversation(body.messages);
    if (!/^\d{4}-\d{4}$/.test(body.academic_year || "") || !/^\d{4}-\d{2}-\d{2}$/.test(body.exam_date || "") || !Number.isFinite(Date.parse(body.exam_date))) throw new Error("invalid_context");
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_conversation", message: "La question ou son contexte est invalide. Recharge la discussion puis réessaie." }, { status: 400 });
  }
  if (!allowRequest(`${institutionId}:${user.id}`)) return NextResponse.json({ ok: false, error: "chat_rate_limited", message: "Tu as envoyé plusieurs questions rapidement. Réessaie dans une minute." }, { status: 429 });
  const model = process.env.AI_GATEWAY_MODEL;
  if (!model) return NextResponse.json({ ok: false, error: "ai_activation_required", message: "Le service de conversation IA doit être activé par l’administrateur." }, { status: 503 });
  const srv = getSupabaseServiceClient();
  const { data: year, error: yearError } = await srv.from("academic_years").select("code")
    .eq("institution_id", institutionId).eq("code", body.academic_year).maybeSingle();
  if (yearError || !year) return NextResponse.json({ ok: false, error: "invalid_academic_year", message: "Cette année scolaire n’est pas configurée pour ton établissement." }, { status: 400 });
  const reader = createSchoolReader({
    srv, institutionId, academicYear: year.code, referenceDate: body.exam_date,
    bulletin: async (classId, from, to) => {
      const url = new URL("/api/admin/grades/bulletin", req.url);
      url.searchParams.set("class_id", classId); url.searchParams.set("from", from); url.searchParams.set("to", to); url.searchParams.set("export_light", "1");
      const response = await getBulletin(new NextRequest(url, { headers: req.headers, signal: req.signal }));
      return response.ok ? response.json() : { ok: false };
    },
    dashboard: async (days) => {
      const url = new URL("/api/admin/dashboard/metrics", req.url); url.searchParams.set("days", String(days));
      const response = await getDashboard(new NextRequest(url, { headers: req.headers, signal: req.signal }));
      return response.ok ? response.json() : { ok: false };
    },
  });
  try {
    const answer = await converse({ messages, academicYear: year.code, referenceDate: body.exam_date, model, signal: req.signal, readSchool: reader.read });
    return NextResponse.json({ ok: true, answer: { title: "Cahier IA", summary: answer.text, students_to_follow: reader.studentsToFollow() }, context_meta: { conversation: true, model: answer.modelId } });
  } catch (error) {
    const failure = conversationError(error);
    console.error("[Mon Cahier IA] conversation unavailable", { code: failure.code });
    return NextResponse.json({ ok: false, error: failure.code, message: failure.message }, { status: failure.status });
  }
}

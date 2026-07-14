import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getContext() {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();
  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) return { error: "unauthorized" as const };

  const { data: profile } = await supa
    .from("profiles")
    .select("institution_id,role")
    .eq("id", user.id)
    .maybeSingle();

  let institutionId = String((profile as any)?.institution_id || "").trim();
  const roles = new Set<string>();
  if ((profile as any)?.role) roles.add(String((profile as any).role));

  const { data: userRoles } = await srv
    .from("user_roles")
    .select("role,institution_id")
    .eq("profile_id", user.id);

  for (const row of userRoles || []) {
    const role = String((row as any).role || "");
    const inst = String((row as any).institution_id || "").trim();
    if (role) roles.add(role);
    if (!institutionId && inst) institutionId = inst;
  }

  if (!institutionId) return { error: "no_institution" as const };
  if (!["admin", "super_admin", "founder"].some((role) => roles.has(role))) {
    return { error: "forbidden" as const };
  }

  return { institutionId, userId: user.id, srv };
}

function migrationResponse(message?: string) {
  return NextResponse.json(
    {
      ok: false,
      error: "distinction_history_table_missing",
      migration_required: true,
      message:
        message ||
        "Exécutez le fichier src/db/distinctions_module_v1.sql dans Supabase pour activer l’historique.",
    },
    { status: 503 },
  );
}

export async function GET(req: NextRequest) {
  const ctx = await getContext();
  if ("error" in ctx) {
    return NextResponse.json({ ok: false, error: ctx.error }, { status: ctx.error === "unauthorized" ? 401 : 403 });
  }

  const url = new URL(req.url);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") || 50)));
  const { data, error } = await ctx.srv
    .from("distinction_publications")
    .select(
      "id,category,title,academic_year,period_code,date_from,date_to,class_ids,recipient_count,snapshot,created_at,created_by",
    )
    .eq("institution_id", ctx.institutionId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    if (/does not exist|schema cache|relation/i.test(error.message)) return migrationResponse(error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  const creatorIds = Array.from(
    new Set((data || []).map((row: any) => String(row.created_by || "")).filter(Boolean)),
  );
  const creatorNames = new Map<string, string>();
  if (creatorIds.length) {
    const { data: profiles } = await ctx.srv
      .from("profiles")
      .select("id,display_name,first_name,last_name,email")
      .in("id", creatorIds);
    for (const profile of profiles || []) {
      const name =
        String((profile as any).display_name || "").trim() ||
        `${(profile as any).last_name || ""} ${(profile as any).first_name || ""}`.trim() ||
        String((profile as any).email || "").split("@")[0] ||
        "Administrateur";
      creatorNames.set(String((profile as any).id), name);
    }
  }

  return NextResponse.json({
    ok: true,
    storage_available: true,
    items: (data || []).map((row: any) => ({
      ...row,
      created_by_name: creatorNames.get(String(row.created_by || "")) || "Administrateur",
    })),
  });
}

export async function POST(req: NextRequest) {
  const ctx = await getContext();
  if ("error" in ctx) {
    return NextResponse.json({ ok: false, error: ctx.error }, { status: ctx.error === "unauthorized" ? 401 : 403 });
  }

  const body = await req.json().catch(() => ({}));
  const category = String(body?.category || "").trim().slice(0, 50);
  const title = String(body?.title || "").trim().slice(0, 180);
  if (!category || !title) {
    return NextResponse.json({ ok: false, error: "category_and_title_required" }, { status: 400 });
  }

  const classIds = Array.isArray(body?.class_ids)
    ? Array.from(new Set(body.class_ids.map((id: unknown) => String(id || "").trim()).filter(Boolean))).slice(0, 200)
    : [];

  const payload = {
    institution_id: ctx.institutionId,
    category,
    title,
    academic_year: String(body?.academic_year || "").trim() || null,
    period_code: String(body?.period_code || "").trim() || null,
    date_from: String(body?.date_from || "").trim() || null,
    date_to: String(body?.date_to || "").trim() || null,
    class_ids: classIds,
    recipient_count: Math.max(0, Math.round(Number(body?.recipient_count || 0))),
    snapshot: body?.snapshot && typeof body.snapshot === "object" ? body.snapshot : {},
    created_by: ctx.userId,
  };

  const { data, error } = await ctx.srv
    .from("distinction_publications")
    .insert(payload)
    .select("id,created_at")
    .maybeSingle();

  if (error || !data) {
    if (error && /does not exist|schema cache|relation/i.test(error.message)) return migrationResponse(error.message);
    return NextResponse.json({ ok: false, error: error?.message || "publication_insert_failed" }, { status: 400 });
  }

  const verificationRows: Array<{
    publication_id: string;
    institution_id: string;
    recipient_key: string;
    recipient_type: "student" | "teacher";
    recipient_name: string;
    class_label: string | null;
    award_title: string;
    summary: Record<string, unknown>;
  }> = [];

  const snapshot = payload.snapshot as any;
  if (category.startsWith("students_")) {
    for (const recipient of Array.isArray(snapshot?.recipients) ? snapshot.recipients : []) {
      const studentId = String(recipient?.student_id || "").trim();
      const classId = String(recipient?.class_id || "").trim();
      const recipientName = String(recipient?.full_name || "").trim();
      if (!studentId || !recipientName) continue;
      const recipientKey = `student:${category}:${classId}:${studentId}`;
      verificationRows.push({
        publication_id: String((data as any).id),
        institution_id: ctx.institutionId,
        recipient_key: recipientKey,
        recipient_type: "student",
        recipient_name: recipientName,
        class_label: String(recipient?.class_label || "").trim() || null,
        award_title: String(recipient?.award_title || title).trim() || title,
        summary: {
          tier: recipient?.tier ?? null,
          honour_rank: recipient?.honour_rank ?? null,
          general_avg: recipient?.general_avg ?? null,
          ranking_avg: recipient?.ranking_avg ?? null,
          conduct_avg: recipient?.conduct_avg ?? null,
        },
      });
    }
  } else if (category === "teachers") {
    for (const award of Array.isArray(snapshot?.awards) ? snapshot.awards : []) {
      const awardKey = String(award?.key || "").trim();
      const teacherId = String(award?.teacher_id || "").trim();
      const recipientName = String(award?.teacher_name || "").trim();
      if (!awardKey || !teacherId || !recipientName) continue;
      verificationRows.push({
        publication_id: String((data as any).id),
        institution_id: ctx.institutionId,
        recipient_key: `teacher:${awardKey}`,
        recipient_type: "teacher",
        recipient_name: recipientName,
        class_label: null,
        award_title: String(award?.title || title).trim() || title,
        summary: {
          score: award?.score ?? null,
          metric_label: award?.metric_label ?? null,
          metric_value: award?.metric_value ?? null,
        },
      });
    }
  }

  let verificationCodes: Record<string, string> = {};
  if (verificationRows.length > 0) {
    const { data: codes, error: verificationError } = await ctx.srv
      .from("distinction_verifications")
      .insert(verificationRows)
      .select("recipient_key,public_code");

    if (verificationError) {
      await ctx.srv.from("distinction_publications").delete().eq("id", (data as any).id);
      if (/does not exist|schema cache|relation/i.test(verificationError.message)) {
        return migrationResponse(verificationError.message);
      }
      return NextResponse.json({ ok: false, error: verificationError.message }, { status: 400 });
    }

    verificationCodes = Object.fromEntries(
      (codes || []).map((row: any) => [String(row.recipient_key), String(row.public_code)]),
    );
  }

  return NextResponse.json({
    ok: true,
    item: data,
    verification_codes: verificationCodes,
  });
}

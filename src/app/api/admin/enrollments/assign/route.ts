// src/app/api/admin/enrollments/assign/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Action = "create_and_assign" | "assign";

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

export async function POST(req: NextRequest) {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: me } = await supa
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();

  const inst = (me?.institution_id ?? null) as string | null;
  if (!inst) return NextResponse.json({ error: "no_institution" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const action: Action = (body?.action || "").trim();
  const class_id: string = String(body?.class_id || "");

  if (!action || (action !== "create_and_assign" && action !== "assign")) {
    return NextResponse.json({ error: "bad_action" }, { status: 400 });
  }
  if (!class_id) return NextResponse.json({ error: "class_id_required" }, { status: 400 });

  // Classe valide ?
  const { data: cls, error: clsErr } = await srv
    .from("classes")
    .select("id,institution_id")
    .eq("id", class_id)
    .maybeSingle();
  if (clsErr) return NextResponse.json({ error: clsErr.message }, { status: 400 });
  if (!cls || (cls as any).institution_id !== inst) {
    return NextResponse.json({ error: "invalid_class" }, { status: 400 });
  }

  let studentId: string | null = null;
  let studentFirst: string | null = null;
  let studentLast: string | null = null;
  let studentMatricule: string | null = null;

  if (action === "create_and_assign") {
    const first_name: string | null = (body?.first_name ?? null) ? String(body.first_name).trim() : null;
    const last_name: string | null = (body?.last_name ?? null) ? String(body.last_name).trim() : null;
    const matricule: string | null = (body?.matricule ?? null) ? String(body.matricule).trim() : null;

    if (matricule) {
      const { data: exist, error: exErr } = await srv
        .from("students")
        .select("id,first_name,last_name,matricule")
        .eq("institution_id", inst)
        .eq("matricule", matricule)
        .maybeSingle();
      if (exErr) return NextResponse.json({ error: exErr.message }, { status: 400 });

      if (exist) {
        studentId = (exist as any).id;
        studentFirst = (exist as any).first_name ?? null;
        studentLast = (exist as any).last_name ?? null;
        studentMatricule = (exist as any).matricule ?? null;

        const patch: any = {};
        if (first_name && first_name !== (studentFirst ?? "")) patch.first_name = first_name;
        if (last_name && last_name !== (studentLast ?? "")) patch.last_name = last_name;

        if (Object.keys(patch).length > 0) {
          const { error: upErr } = await srv.from("students").update(patch).eq("id", studentId);
          if (upErr) return NextResponse.json({ error: upErr.message }, { status: 400 });
          studentFirst = patch.first_name ?? studentFirst;
          studentLast = patch.last_name ?? studentLast;
        }
      } else {
        const { data: created, error: cErr } = await srv
          .from("students")
          .insert([{ institution_id: inst, first_name, last_name, matricule }])
          .select("id,first_name,last_name,matricule")
          .maybeSingle();
        if (cErr) return NextResponse.json({ error: cErr.message }, { status: 400 });

        studentId = (created as any).id;
        studentFirst = (created as any).first_name ?? null;
        studentLast = (created as any).last_name ?? null;
        studentMatricule = (created as any).matricule ?? null;
      }
    } else {
      const { data: created, error: cErr } = await srv
        .from("students")
        .insert([{ institution_id: inst, first_name, last_name, matricule: null }])
        .select("id,first_name,last_name,matricule")
        .maybeSingle();
      if (cErr) return NextResponse.json({ error: cErr.message }, { status: 400 });

      studentId = (created as any).id;
      studentFirst = (created as any).first_name ?? null;
      studentLast = (created as any).last_name ?? null;
      studentMatricule = (created as any).matricule ?? null;
    }
  } else {
    // assign (par matricule OU par student_id)
    const matricule: string = String(body?.matricule || "").trim();
    const byId: string = String(body?.student_id || "").trim();

    if (!matricule && !byId) {
      return NextResponse.json({ error: "matricule_or_student_id_required" }, { status: 400 });
    }

    if (byId) {
      const { data: exist, error: exErr } = await srv
        .from("students")
        .select("id,first_name,last_name,matricule,institution_id")
        .eq("id", byId)
        .maybeSingle();
      if (exErr) return NextResponse.json({ error: exErr.message }, { status: 400 });
      if (!exist) return NextResponse.json({ error: "student_not_found" }, { status: 404 });
      if ((exist as any).institution_id !== inst) {
        return NextResponse.json({ error: "student_wrong_institution" }, { status: 403 });
      }
      studentId = (exist as any).id;
      studentFirst = (exist as any).first_name ?? null;
      studentLast = (exist as any).last_name ?? null;
      studentMatricule = (exist as any).matricule ?? null;
    } else {
      const { data: exist, error: exErr } = await srv
        .from("students")
        .select("id,first_name,last_name,matricule")
        .eq("institution_id", inst)
        .eq("matricule", matricule)
        .maybeSingle();
      if (exErr) return NextResponse.json({ error: exErr.message }, { status: 400 });
      if (!exist) return NextResponse.json({ error: "student_not_found" }, { status: 404 });

      studentId = (exist as any).id;
      studentFirst = (exist as any).first_name ?? null;
      studentLast = (exist as any).last_name ?? null;
      studentMatricule = (exist as any).matricule ?? null;
    }
  }

  if (!studentId) return NextResponse.json({ error: "student_resolve_failed" }, { status: 400 });

  const today = isoToday();

  // Clôturer autres classes
  const { data: oldClosed, error: oldErr } = await srv
    .from("class_enrollments")
    .update({ end_date: today })
    .eq("institution_id", inst)
    .eq("student_id", studentId)
    .neq("class_id", class_id)
    .is("end_date", null)
    .select("id");
  if (oldErr) return NextResponse.json({ error: oldErr.message }, { status: 400 });

  // Réactiver si déjà présent dans la cible
  const { data: reactivated, error: reacErr } = await srv
    .from("class_enrollments")
    .update({ end_date: null /*, start_date: today*/ })
    .eq("institution_id", inst)
    .eq("student_id", studentId)
    .eq("class_id", class_id)
    .select("id");
  if (reacErr) return NextResponse.json({ error: reacErr.message }, { status: 400 });

  // Upsert dans la classe cible
  const row = { class_id, student_id: studentId, institution_id: inst, start_date: today, end_date: null };
  const { data: inserted, error: insErr } = await srv
    .from("class_enrollments")
    .upsert([row], { onConflict: "class_id,student_id", ignoreDuplicates: true })
    .select("id");
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 400 });

  return NextResponse.json({
    ok: true,
    student: { id: studentId, first_name: studentFirst, last_name: studentLast, matricule: studentMatricule },
    closed_old_enrollments: (oldClosed ?? []).length,
    reactivated_in_target: (reactivated ?? []).length,
    inserted_in_target: (inserted ?? []).length,
  });
}

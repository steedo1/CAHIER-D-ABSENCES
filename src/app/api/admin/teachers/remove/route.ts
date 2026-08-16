// src/app/api/admin/teachers/remove/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

type Body = {
  /** ID du profil enseignant à retirer (obligatoire) */
  profile_id: string;
  /** Termine les séances ouvertes dans l'établissement (par défaut: true) */
  end_open_sessions?: boolean;
  /**
   * Si profiles.institution_id pointe sur l'établissement courant, choisit un
   * autre établissement où le professeur reste actif ; sinon le met à NULL.
   * Par défaut: true.
   */
  unset_profile_institution?: boolean;
};

export async function POST(req: NextRequest) {
  try {
    const supa = await getSupabaseServerClient();
    const srv = getSupabaseServiceClient();

    const {
      data: { user },
    } = await supa.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const { data: me, error: meErr } = await supa
      .from("profiles")
      .select("institution_id")
      .eq("id", user.id)
      .maybeSingle();
    if (meErr) {
      return NextResponse.json({ error: meErr.message }, { status: 400 });
    }

    const adminInst = String(me?.institution_id || "").trim() || null;
    if (!adminInst) {
      return NextResponse.json(
        { error: "no_institution_for_admin" },
        { status: 400 },
      );
    }

    const { data: myRoles, error: rolesErr } = await srv
      .from("user_roles")
      .select("role,institution_id")
      .eq("profile_id", user.id);
    if (rolesErr) {
      return NextResponse.json({ error: rolesErr.message }, { status: 400 });
    }

    const isAdminHere = (myRoles || []).some(
      (r: any) =>
        String(r.institution_id) === adminInst &&
        (r.role === "admin" || r.role === "super_admin"),
    );
    const isSuper = (myRoles || []).some(
      (r: any) => r.role === "super_admin",
    );
    if (!isAdminHere && !isSuper) {
      return NextResponse.json(
        { error: "forbidden_admin_required" },
        { status: 403 },
      );
    }

    const body = (await req.json().catch(() => ({}))) as Body;
    const teacherId = String(body?.profile_id || "").trim();
    const endOpen = body?.end_open_sessions ?? true;
    const unsetInst = body?.unset_profile_institution ?? true;

    if (!teacherId) {
      return NextResponse.json(
        { error: "profile_id_required" },
        { status: 400 },
      );
    }
    if (teacherId === user.id) {
      return NextResponse.json(
        { error: "cannot_remove_yourself" },
        { status: 400 },
      );
    }

    const { data: target, error: targetErr } = await srv
      .from("profiles")
      .select("id,institution_id,display_name")
      .eq("id", teacherId)
      .maybeSingle();
    if (targetErr) {
      return NextResponse.json({ error: targetErr.message }, { status: 400 });
    }
    if (!target) {
      return NextResponse.json({ error: "user_not_found" }, { status: 404 });
    }

    const { data: teacherRole, error: teacherRoleErr } = await srv
      .from("user_roles")
      .select("profile_id")
      .eq("profile_id", teacherId)
      .eq("institution_id", adminInst)
      .eq("role", "teacher")
      .maybeSingle();
    if (teacherRoleErr) {
      return NextResponse.json(
        { error: teacherRoleErr.message },
        { status: 400 },
      );
    }

    if (!teacherRole) {
      return NextResponse.json({
        ok: true,
        removed_role: 0,
        ended_sessions: 0,
        cleared_institution: false,
        reassigned_profile_institution: null,
        info: "no_teacher_role_for_this_institution",
      });
    }

    // Retrait actif uniquement : on ne touche volontairement pas à
    // class_teachers, aux notes, aux appels ni aux anciennes années scolaires.
    const { error: deleteRoleErr } = await srv
      .from("user_roles")
      .delete()
      .eq("profile_id", teacherId)
      .eq("institution_id", adminInst)
      .eq("role", "teacher");
    if (deleteRoleErr) {
      return NextResponse.json(
        { error: deleteRoleErr.message },
        { status: 400 },
      );
    }

    let ended = 0;
    if (endOpen) {
      const { data: openRows, error: openRowsErr } = await srv
        .from("teacher_sessions")
        .select("id")
        .eq("teacher_id", teacherId)
        .eq("institution_id", adminInst)
        .is("ended_at", null);
      if (openRowsErr) {
        return NextResponse.json(
          { error: openRowsErr.message },
          { status: 400 },
        );
      }

      if (openRows?.length) {
        const { error: closeErr } = await srv
          .from("teacher_sessions")
          .update({ ended_at: new Date().toISOString() })
          .eq("teacher_id", teacherId)
          .eq("institution_id", adminInst)
          .is("ended_at", null);
        if (closeErr) {
          return NextResponse.json(
            { error: closeErr.message },
            { status: 400 },
          );
        }
        ended = openRows.length;
      }
    }

    let cleared = false;
    let reassignedInstitution: string | null = null;

    if (unsetInst && String(target.institution_id || "") === adminInst) {
      const { data: remainingRoles, error: remainingRolesErr } = await srv
        .from("user_roles")
        .select("institution_id")
        .eq("profile_id", teacherId)
        .eq("role", "teacher")
        .not("institution_id", "is", null)
        .limit(1);

      if (remainingRolesErr) {
        return NextResponse.json(
          { error: remainingRolesErr.message },
          { status: 400 },
        );
      }

      reassignedInstitution =
        String(remainingRoles?.[0]?.institution_id || "").trim() || null;

      const { error: profileErr } = await srv
        .from("profiles")
        .update({ institution_id: reassignedInstitution })
        .eq("id", teacherId);
      if (profileErr) {
        return NextResponse.json(
          { error: profileErr.message },
          { status: 400 },
        );
      }

      cleared = reassignedInstitution === null;
    }

    return NextResponse.json({
      ok: true,
      removed_role: 1,
      ended_sessions: ended,
      cleared_institution: cleared,
      reassigned_profile_institution: reassignedInstitution,
      history_preserved: true,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "server_error" },
      { status: 500 },
    );
  }
}

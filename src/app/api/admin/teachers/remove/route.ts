// src/app/api/admin/teachers/remove/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

type Body = {
  /** ID du profil enseignant � retirer (obligatoire) */
  profile_id: string;
  /** Termine les s�ances ouvertes dans l�"�tablissement (par d�faut: true) */
  end_open_sessions?: boolean;
  /**
   * Met profiles.institution_id � NULL si �gal � l�"�tablissement admin courant
   * (par d�faut: true)
   */
  unset_profile_institution?: boolean;
};

export async function POST(req: Request) {
  try {
    const supa = await getSupabaseServerClient();   // RLS (cookie admin)
    const srv  = getSupabaseServiceClient();        // service (no RLS)

    // Qui appelle ?
    const { data: { user } } = await supa.auth.getUser();
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    // R�cup�re l�"�tablissement de l�"admin (scope par d�faut)
    const { data: me, error: meErr } = await supa
      .from("profiles")
      .select("institution_id")
      .eq("id", user.id)
      .maybeSingle();
    if (meErr) return NextResponse.json({ error: meErr.message }, { status: 400 });

    const adminInst = (me?.institution_id as string) || null;
    if (!adminInst) {
      return NextResponse.json({ error: "no_institution_for_admin" }, { status: 400 });
    }

    // V�rifie que l'appelant est admin/super_admin sur cet �tablissement
    const { data: myRoles, error: rolesErr } = await srv
      .from("user_roles")
      .select("role,institution_id")
      .eq("profile_id", user.id);
    if (rolesErr) return NextResponse.json({ error: rolesErr.message }, { status: 400 });

    const isAdminHere = (myRoles || []).some(
      (r) => (r.institution_id as string) === adminInst && (r.role === "admin" || r.role === "super_admin")
    );
    const isSuper = (myRoles || []).some((r) => r.role === "super_admin");
    if (!isAdminHere && !isSuper) {
      return NextResponse.json({ error: "forbidden_admin_required" }, { status: 403 });
    }

    // Payload
    const body = (await req.json().catch(() => ({}))) as Body;
    const teacherId = (body?.profile_id || "").trim();
    const endOpen   = body?.end_open_sessions ?? true;
    const unsetInst = body?.unset_profile_institution ?? true;

    if (!teacherId) {
      return NextResponse.json({ error: "profile_id_required" }, { status: 400 });
    }
    if (teacherId === user.id) {
      return NextResponse.json({ error: "cannot_remove_yourself" }, { status: 400 });
    }

    // V�rifie que l�"utilisateur cible existe
    const { data: target, error: tErr } = await srv
      .from("profiles")
      .select("id,institution_id,display_name")
      .eq("id", teacherId)
      .maybeSingle();
    if (tErr) return NextResponse.json({ error: tErr.message }, { status: 400 });
    if (!target) return NextResponse.json({ error: "user_not_found" }, { status: 404 });

    // V�rifie qu'il est bien 'teacher' dans cet �tablissement
    const { data: teacherRole } = await srv
      .from("user_roles")
      .select("profile_id")
      .eq("profile_id", teacherId)
      .eq("institution_id", adminInst)
      .eq("role", "teacher")
      .maybeSingle();
    if (!teacherRole) {
      // Rien � retirer : on r�pond ok=false mais sans erreur bloquante
      return NextResponse.json({
        ok: true,
        removed_role: 0,
        ended_sessions: 0,
        cleared_institution: false,
        info: "no_teacher_role_for_this_institution"
      });
    }

    // 1) supprime le r�le 'teacher' pour cet �tablissement
    const { error: delErr } = await srv
      .from("user_roles")
      .delete()
      .eq("profile_id", teacherId)
      .eq("institution_id", adminInst)
      .eq("role", "teacher");
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 400 });

    // 2) cl�ture les s�ances ouvertes dans cet �tablissement (optionnel)
    let ended = 0;
    if (endOpen) {
      const { data: openRows, error: qOpenErr } = await srv
        .from("teacher_sessions")
        .select("id")
        .eq("teacher_id", teacherId)
        .eq("institution_id", adminInst)
        .is("ended_at", null);
      if (qOpenErr) return NextResponse.json({ error: qOpenErr.message }, { status: 400 });

      if (openRows && openRows.length) {
        const { error: updErr } = await srv
          .from("teacher_sessions")
          .update({ ended_at: new Date().toISOString() })
          .eq("teacher_id", teacherId)
          .eq("institution_id", adminInst)
          .is("ended_at", null);
        if (updErr) return NextResponse.json({ error: updErr.message }, { status: 400 });
        ended = openRows.length;
      }
    }

    // 3) nettoie profiles.institution_id si �a pointe sur l�"ancien �tablissement (optionnel)
    let cleared = false;
    if (unsetInst && String(target.institution_id || "") === adminInst) {
      const { error: upErr } = await srv
        .from("profiles")
        .update({ institution_id: null })
        .eq("id", teacherId);
      if (upErr) return NextResponse.json({ error: upErr.message }, { status: 400 });
      cleared = true;
    }

    return NextResponse.json({
      ok: true,
      removed_role: 1,
      ended_sessions: ended,
      cleared_institution: cleared,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "server_error" }, { status: 500 });
  }
}



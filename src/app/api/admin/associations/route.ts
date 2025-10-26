// src/app/api/admin/associations/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { normalizePhone as toE164 } from "@/lib/phone";

const DEFAULT_TEMP_PASSWORD = process.env.DEFAULT_TEMP_PASSWORD || "Pass2025";

/* ---------------------- Helpers ---------------------- */
/**
 * Résout ou crée un parent :
 * - normalise le téléphone,
 * - cherche d'abord dans profiles (par phone/email),
 * - sinon dans auth.users,
 * - sinon crée le compte,
 * - upsert le profil avec whatsapp_opt_in = true (numéro considéré WhatsApp).
 */
async function resolveOrCreateParent(
  srv: any,
  opts: { phone?: string | null; email?: string | null; display_name?: string | null }
): Promise<string> {
  const phoneNorm = toE164(opts.phone ?? null);
  const email = (opts.email ?? null) || null;
  const display_name = (opts.display_name ?? null) || null;

  // 1) profiles par téléphone / email
  if (phoneNorm) {
    const { data } = await srv.from("profiles").select("id").eq("phone", phoneNorm).maybeSingle();
    if (data?.id) {
      // Active l'opt-in WhatsApp sans casser le reste
      await srv.from("profiles").update({ whatsapp_opt_in: true }).eq("id", data.id);
      return data.id as string;
    }
  }
  if (email) {
    const { data } = await srv.from("profiles").select("id").eq("email", email).maybeSingle();
    if (data?.id) {
      await srv
        .from("profiles")
        .update({ phone: phoneNorm ?? undefined, whatsapp_opt_in: true })
        .eq("id", data.id);
      return data.id as string;
    }
  }

  // Helper : lookup auth.users
  const findInAuth = async () => {
    if (phoneNorm) {
      const { data: au1 } = await srv.from("auth.users").select("id").eq("phone", phoneNorm).maybeSingle();
      if (au1?.id) return String(au1.id);
    }
    if (email) {
      const { data: au2 } = await srv.from("auth.users").select("id").eq("email", email).maybeSingle();
      if (au2?.id) return String(au2.id);
    }
    return null;
  };

  // 2) auth.users
  let uid = await findInAuth();
  if (uid) {
    await srv.from("profiles").upsert(
      { id: uid, display_name, email: email ?? null, phone: phoneNorm ?? null, whatsapp_opt_in: true },
      { onConflict: "id" }
    );
    return uid;
  }

  // 3) create
  const { data: created, error: cErr } = await srv.auth.admin.createUser({
    email: email || undefined,
    phone: phoneNorm || undefined,
    password: DEFAULT_TEMP_PASSWORD,
    email_confirm: !!email,
    phone_confirm: !!phoneNorm,
    user_metadata: { display_name, phone: phoneNorm, email },
  });

  if (cErr || !created?.user) {
    uid = await findInAuth();
    if (!uid) {
      const err = new Error(cErr?.message || "create_parent_failed") as any;
      err.status = /already/i.test(cErr?.message || "") ? 409 : 400;
      throw err;
    }
  } else {
    uid = created.user.id as string;
  }

  // 4) upsert profil
  const { error: pErr } = await srv.from("profiles").upsert(
    { id: uid, display_name, email: email ?? null, phone: phoneNorm ?? null, whatsapp_opt_in: true },
    { onConflict: "id" }
  );
  if (pErr) {
    const err = new Error(pErr.message) as any;
    err.status = 400;
    throw err;
  }

  return uid;
}

export async function POST(req: Request) {
  const supa = await getSupabaseServerClient();
  const srv  = getSupabaseServiceClient();

  // Auth appelant
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Etablissement
  const { data: me, error: meErr } = await supa
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();
  if (meErr) return NextResponse.json({ error: meErr.message }, { status: 400 });

  const inst = (me?.institution_id as string) || null;
  if (!inst) return NextResponse.json({ error: "no_institution" }, { status: 400 });

  // Payload
  const body = await req.json();
  const type = body?.type as
    | "teacher_classes"
    | "teacher_class_remove"
    | "teacher_classes_clear"
    | "teacher_classes_clear_all" // NEW (reset global)
    | "parent_student"
    | "parent_students"
    | "guardian_notifications"
    | "teacher_discipline";

  /* ──────────────────────────────────────────────────────────
     AFFECTATIONS / INSERT (existant)
  ─────────────────────────────────────────────────────────── */
  if (type === "teacher_classes") {
    const teacher_id: string | null = body?.teacher_id ?? null;
    const email: string | null = body?.email ?? null;
    const subject_id_raw: string | null = body?.subject_id ?? null;
    const class_ids: string[] = Array.isArray(body?.class_ids) ? body.class_ids : [];

    if ((!teacher_id && !email) || class_ids.length === 0) {
      return NextResponse.json({ error: "missing_params" }, { status: 400 });
    }

    // Resolve teacher id
    let tid: string | null = teacher_id;
    if (!tid && email) {
      const { data: t } = await srv
        .from("profiles")
        .select("id")
        .eq("email", email)
        .eq("institution_id", inst)
        .maybeSingle();
      tid = t?.id ?? null;
    }
    if (!tid) return NextResponse.json({ error: "teacher_not_found" }, { status: 404 });

    // Optionnelle: matière (tolère institution_subjects.id ou subjects.id)
    let instSubjectId: string | null = null;
    if (subject_id_raw) {
      const { data: link } = await srv
        .from("institution_subjects")
        .select("id, subject_id")
        .eq("institution_id", inst)
        .or(`id.eq.${subject_id_raw},subject_id.eq.${subject_id_raw}`)
        .limit(1)
        .maybeSingle();
      instSubjectId = link?.id ?? null;
    }

    // Reset affectations existantes (pour cet enseignant, et discipline si fournie)
    let del = srv.from("class_teachers").delete().eq("teacher_id", tid).eq("institution_id", inst);
    if (subject_id_raw) {
      del = instSubjectId ? del.eq("subject_id", instSubjectId) : del.eq("subject_id", subject_id_raw);
    }
    const { error: dErr } = await del;
    if (dErr) return NextResponse.json({ error: dErr.message }, { status: 400 });

    const today = new Date().toISOString().slice(0, 10);
    const buildRows = (sid: string | null) =>
      class_ids.map((cid: string) => ({
        class_id: cid,
        teacher_id: tid!,
        subject_id: sid,
        institution_id: inst!,
        start_date: today,
        end_date: null,
      }));

    let { error: iErr, count } = await srv.from("class_teachers").insert(buildRows(subject_id_raw), { count: "exact" });

    if (iErr && (iErr as any).code === "23503" && subject_id_raw && instSubjectId) {
      const res2 = await srv.from("class_teachers").insert(buildRows(instSubjectId), { count: "exact" });
      iErr = res2.error;
      count = (res2 as any).count ?? count;
    }
    if (iErr) return NextResponse.json({ error: iErr.message }, { status: 400 });

    return NextResponse.json({ ok: true, inserted: count ?? class_ids.length });
  }

  /* ──────────────────────────────────────────────────────────
     Retirer UNE classe (existant étendu)
  ─────────────────────────────────────────────────────────── */
  if (type === "teacher_class_remove") {
    const teacher_id: string = body?.teacher_id;
    const class_id: string   = body?.class_id;
    const subject_id_raw: string | null = body?.subject_id ?? null;
    if (!teacher_id || !class_id) {
      return NextResponse.json({ error: "missing_params" }, { status: 400 });
    }

    let del = srv
      .from("class_teachers")
      .delete()
      .eq("institution_id", inst)
      .eq("teacher_id", teacher_id)
      .eq("class_id", class_id);

    if (subject_id_raw) {
      const { data: link } = await srv
        .from("institution_subjects")
        .select("id,subject_id")
        .eq("institution_id", inst)
        .or(`id.eq.${subject_id_raw},subject_id.eq.${subject_id_raw}`)
        .limit(1)
        .maybeSingle();
      del = link?.id ? del.eq("subject_id", link.id) : del.eq("subject_id", subject_id_raw);
    }

    const { error, count } = await (del as any);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, removed: count ?? 1 });
  }

  /* ──────────────────────────────────────────────────────────
     Retirer TOUTES les classes d’un enseignant
  ─────────────────────────────────────────────────────────── */
  if (type === "teacher_classes_clear") {
    const teacher_id: string = body?.teacher_id;
    const subject_id_raw: string | null = body?.subject_id ?? null;
    if (!teacher_id) return NextResponse.json({ error: "missing_params" }, { status: 400 });

    let del = srv
      .from("class_teachers")
      .delete()
      .eq("institution_id", inst)
      .eq("teacher_id", teacher_id);

    if (subject_id_raw) {
      const { data: link } = await srv
        .from("institution_subjects")
        .select("id,subject_id")
        .eq("institution_id", inst)
        .or(`id.eq.${subject_id_raw},subject_id.eq.${subject_id_raw}`)
        .limit(1)
        .maybeSingle();
      del = link?.id ? del.eq("subject_id", link.id) : del.eq("subject_id", subject_id_raw);
    }

    const { error, count } = await (del as any);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, removed: count ?? 0 });
  }

  /* ──────────────────────────────────────────────────────────
     NEW : Retirer pour TOUS les enseignants (reset global)
     Options:
       - subject_id (facultatif) : institution_subjects.id OU subjects.id
       - class_ids (facultatif)  : restreindre à une liste de classes
       - level (facultatif)      : restreindre aux classes d'un niveau
  ─────────────────────────────────────────────────────────── */
  if (type === "teacher_classes_clear_all") {
    const subject_id_raw: string | null = body?.subject_id ?? null;
    const class_ids: string[] | null = Array.isArray(body?.class_ids) ? body.class_ids : null;
    const level: string | null = body?.level ?? null;

    let del = srv.from("class_teachers").delete().eq("institution_id", inst);

    // Filtre discipline
    if (subject_id_raw) {
      const { data: link } = await srv
        .from("institution_subjects")
        .select("id,subject_id")
        .eq("institution_id", inst)
        .or(`id.eq.${subject_id_raw},subject_id.eq.${subject_id_raw}`)
        .limit(1)
        .maybeSingle();
      del = link?.id ? del.eq("subject_id", link.id) : del.eq("subject_id", subject_id_raw);
    }

    // Filtre classes explicites
    if (class_ids && class_ids.length) {
      del = del.in("class_id", class_ids);
    } else if (level) {
      // Filtre par niveau (optionnel)
      const { data: cls } = await srv
        .from("classes")
        .select("id")
        .eq("institution_id", inst)
        .eq("level", level);
      const ids = (cls || []).map((c: any) => c.id);
      if (ids.length) del = del.in("class_id", ids);
      else {
        return NextResponse.json({ ok: true, removed: 0 });
      }
    }

    const { error, count } = await (del as any);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, removed: count ?? 0 });
  }

  /* ──────────────────────────────────────────────────────────
     Liens parents (avec opt-in WhatsApp automatique)
  ─────────────────────────────────────────────────────────── */
  if (type === "parent_students") {
    const student_ids: string[] = Array.isArray(body?.student_ids) ? body.student_ids : [];
    if (!student_ids.length) return NextResponse.json({ error: "no_students" }, { status: 400 });

    let parent_id: string;
    try {
      parent_id = await resolveOrCreateParent(srv, {
        phone: body?.phone ?? null,          // ← numéro WhatsApp à utiliser
        email: body?.email ?? null,
        display_name: body?.display_name ?? null,
      });
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || "create_parent_failed" }, { status: e?.status || 400 });
    }

    await srv.from("user_roles").upsert(
      { profile_id: parent_id, institution_id: inst, role: "parent" },
      { onConflict: "profile_id,institution_id,role" }
    );

    const rows = student_ids.map((sid) => ({
      parent_id,
      student_id: sid,
      institution_id: inst,
      notifications_enabled: true,
    }));

    let upErr: any = null;
    try {
      const { error } = await srv.from("student_guardians").upsert(rows as any, { onConflict: "parent_id,student_id" });
      upErr = error;
    } catch (e: any) {
      upErr = e;
    }
    if (upErr) {
      const { error: e2 } = await srv.from("student_guardians").upsert(
        rows.map(({ parent_id, student_id, notifications_enabled }) => ({ parent_id, student_id, notifications_enabled })) as any,
        { onConflict: "parent_id,student_id" }
      );
      if (e2) return NextResponse.json({ error: e2.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, parent_id, linked: student_ids.length });
  }

  if (type === "parent_student") {
    const student_id: string = body?.student_id;
    if (!student_id) return NextResponse.json({ error: "missing_params" }, { status: 400 });

    const { data: st, error: stErr } = await srv
      .from("students")
      .select("id,institution_id")
      .eq("id", student_id)
      .maybeSingle();
    if (stErr) return NextResponse.json({ error: stErr.message }, { status: 400 });
    if (!st || (st as any).institution_id !== inst) {
      return NextResponse.json({ error: "invalid_student_or_institution" }, { status: 400 });
    }

    let parent_id: string;
    try {
      parent_id = await resolveOrCreateParent(srv, {
        phone: body?.phone ?? null,      // ← numéro WhatsApp
        email: body?.email ?? null,
        display_name: body?.display_name ?? null,
      });
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || "create_parent_failed" }, { status: e?.status || 400 });
    }

    await srv.from("user_roles").upsert(
      { profile_id: parent_id, institution_id: inst, role: "parent" },
      { onConflict: "profile_id,institution_id,role" }
    );

    let upErr: any = null;
    try {
      const { error } = await srv
        .from("student_guardians")
        .upsert({ parent_id, student_id, institution_id: inst, notifications_enabled: true } as any, {
          onConflict: "parent_id,student_id",
        });
      upErr = error;
    } catch (e: any) {
      upErr = e;
    }
    if (upErr) {
      const { error: e2 } = await srv
        .from("student_guardians")
        .upsert({ parent_id, student_id, notifications_enabled: true } as any, {
          onConflict: "parent_id,student_id",
        });
      if (e2) return NextResponse.json({ error: e2.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, parent_id, linked: 1 });
  }

  if (type === "guardian_notifications") {
    const student_id: string = body?.student_id;
    const enabled: boolean = Boolean(body?.enabled);
    if (!student_id) return NextResponse.json({ error: "missing_params" }, { status: 400 });

    let parent_id: string | null = body?.parent_id ?? null;
    if (!parent_id) {
      const phoneNorm = toE164(body?.phone ?? null);
      const email: string | null = (body?.email ?? null) || null;

      if (phoneNorm) {
        const { data } = await srv.from("profiles").select("id").eq("phone", phoneNorm).maybeSingle();
        parent_id = data?.id ?? null;
      }
      if (!parent_id && email) {
        const { data } = await srv.from("profiles").select("id").eq("email", email).maybeSingle();
        parent_id = data?.id ?? null;
      }
      if (!parent_id) {
        if (phoneNorm) {
          const { data } = await srv.from("auth.users").select("id").eq("phone", phoneNorm).maybeSingle();
          parent_id = data?.id ?? null;
        }
        if (!parent_id && email) {
          const { data } = await srv.from("auth.users").select("id").eq("email", email).maybeSingle();
          parent_id = data?.id ?? null;
        }
      }
    }
    if (!parent_id) return NextResponse.json({ error: "parent_not_found" }, { status: 404 });

    const { error: uErr } = await srv
      .from("student_guardians")
      .update({ notifications_enabled: enabled })
      .eq("parent_id", parent_id)
      .eq("student_id", student_id);
    if (uErr) return NextResponse.json({ error: uErr.message }, { status: 400 });

    return NextResponse.json({ ok: true, enabled });
  }

  if (type === "teacher_discipline") {
    return NextResponse.json({ error: "not_implemented_for_current_schema" }, { status: 400 });
  }

  return NextResponse.json({ error: "bad_type" }, { status: 400 });
}

// src/app/api/teacher/classes/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

// On ne se bat pas avec les types générés par Supabase pour les relations : on lit en `any`.
type ItemOut = {
  class_id: string;
  class_label: string;
  level: string;
  subject_id: string | null;
  subject_name: string | null;
};

export async function GET() {
  try {
    const supa = await getSupabaseServerClient();
    const {
      data: { user },
    } = await supa.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    // Profil (institution + phone pour les comptes classe)
    const { data: me, error: meErr } = await supa
      .from("profiles")
      .select("id,institution_id,phone")
      .eq("id", user.id)
      .maybeSingle();

    if (meErr) {
      return NextResponse.json({ error: meErr.message }, { status: 400 });
    }

    // Rôles (pour détecter le compte classe)
    const { data: rolesData } = await supa
      .from("user_roles")
      .select("role")
      .eq("profile_id", user.id);

    const hasClassDeviceRole = (rolesData || []).some(
      (r: any) => r.role === "class_device"
    );

    let items: ItemOut[] = [];

    if (hasClassDeviceRole) {
      // 👉 Compte CLASSE (téléphone de la classe)
      items = await loadClassesForClassDevice(supa, me);
    } else {
      // 👉 Comportement HISTORIQUE (prof, ou tout autre profil utilisant class_teachers.teacher_id)
      items = await loadClassesForTeacher(supa, user.id);
    }

    return NextResponse.json({ items });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "classes_failed" },
      { status: 400 }
    );
  }
}

/* ============================================================================
   Helpers
============================================================================ */

/**
 * Cas historique : PROF
 * - On lit class_teachers où teacher_id = user.id
 * - On récupère classes:class_id(label,level)
 * - On enrichit avec le nom de la matière via institution_subjects
 */
async function loadClassesForTeacher(supa: any, teacherId: string): Promise<ItemOut[]> {
  const { data, error } = await supa
    .from("class_teachers")
    .select("class_id, subject_id, classes:class_id(label,level)")
    .eq("teacher_id", teacherId);

  if (error) {
    throw new Error(error.message);
  }

  return materializeItems(supa, (data || []) as any[]);
}

/**
 * Cas COMPTE CLASSE (class_device) :
 * - On part du téléphone du profil (me.phone)
 * - On trouve les classes qui utilisent ce téléphone (class_phone_e164 / device_phone_e164)
 * - On regarde les class_teachers pour ces classes (tous les profs / toutes les matières)
 * - On retourne la même forme ItemOut que pour le prof
 */
async function loadClassesForClassDevice(
  supa: any,
  me: { institution_id?: string | null; phone?: string | null } | null
): Promise<ItemOut[]> {
  if (!me?.phone) {
    // Pas de téléphone = on ne sait pas à quelle classe rattacher ce device
    return [];
  }

  // 1) Classes reliées à ce téléphone
  let clsQuery = supa
    .from("classes")
    .select("id,label,level,class_phone_e164,device_phone_e164");

  if (me.institution_id) {
    clsQuery = clsQuery.eq("institution_id", me.institution_id);
  }

  const { data: clsData, error: clsErr } = await clsQuery.or(
    `class_phone_e164.eq.${me.phone},device_phone_e164.eq.${me.phone}`
  );

  if (clsErr) {
    throw new Error(clsErr.message);
  }

  const classIds = (clsData || []).map((c: any) => c.id as string);
  if (!classIds.length) {
    return [];
  }

  // 2) Toutes les matières affectées à ces classes
  const { data, error } = await supa
    .from("class_teachers")
    .select("class_id, subject_id, classes:class_id(label,level)")
    .in("class_id", classIds);

  if (error) {
    throw new Error(error.message);
  }

  // On réutilise la même logique de matérialisation que pour le prof
  return materializeItems(supa, (data || []) as any[]);
}

/**
 * Transforme les lignes (class_id, subject_id, classes:class_id(...))
 * en ItemOut dédoublonné et trié par libellé de classe.
 */
async function materializeItems(supa: any, rows: any[]): Promise<ItemOut[]> {
  const items: ItemOut[] = [];

  for (const raw of rows) {
    const cls = (raw as any).classes as any; // objet { label, level }
    if (!cls) continue;

    let subject_name: string | null = null;

    if (raw.subject_id) {
      // Même logique qu'avant : on accepte que subject_id soit soit institution_subjects.id
      // soit subjects.id, d'où la condition OR.
      const { data: isub } = await supa
        .from("institution_subjects")
        .select("custom_name, subjects:subject_id(name)")
        .or(`id.eq.${raw.subject_id},subject_id.eq.${raw.subject_id}`)
        .limit(1)
        .maybeSingle();

      subject_name =
        (isub as any)?.custom_name ??
        (isub as any)?.subjects?.name ??
        null;
    }

    items.push({
      class_id: raw.class_id as string,
      class_label: String(cls.label ?? "�"),
      level: String(cls.level ?? "�"),
      subject_id: (raw.subject_id ?? null) as string | null,
      subject_name,
    });
  }

  // Dédoublonner (class_id + subject_id) et trier par libellé de classe
  const seen = new Set<string>();
  const uniq = items
    .filter((it) => {
      const k = `${it.class_id}|${it.subject_id || ""}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) =>
      a.class_label.localeCompare(b.class_label, undefined, { numeric: true })
    );

  return uniq;
}

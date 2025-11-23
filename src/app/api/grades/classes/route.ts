// src/app/api/grades/classes/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Mode = "teacher" | "class_device" | "other";

type TeachClass = {
  class_id: string;
  class_label: string;
  level: string;
  subject_id: string | null;
  subject_name: string | null;
};

export async function GET(_req: NextRequest) {
  try {
    const supabase = await getSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ mode: null, items: [] as TeachClass[] });
    }

    // 1) Profil + établissement
    const { data: profile, error: profErr } = await supabase
      .from("profiles")
      .select("id,institution_id,phone")
      .eq("id", user.id)
      .maybeSingle();

    if (profErr) {
      console.error("[grades/classes] profile error", profErr);
      return NextResponse.json({ mode: null, items: [] as TeachClass[] });
    }
    if (!profile?.institution_id) {
      return NextResponse.json({ mode: null, items: [] as TeachClass[] });
    }

    // 2) Rôles
    const { data: roles, error: rolesErr } = await supabase
      .from("user_roles")
      .select("role")
      .eq("profile_id", profile.id)
      .eq("institution_id", profile.institution_id);

    if (rolesErr) {
      console.error("[grades/classes] roles error", rolesErr);
    }

    const roleSet = new Set<string>((roles ?? []).map((r: any) => r.role as string));
    const isTeacher = roleSet.has("teacher");
    const isClassDevice = roleSet.has("class_device");

    const srv = getSupabaseServiceClient();

    const items: TeachClass[] = [];
    const seen = new Set<string>();

    const pushUnique = (tc: TeachClass) => {
      const key = `${tc.class_id}|${tc.subject_id ?? ""}`;
      if (seen.has(key)) return;
      seen.add(key);
      items.push(tc);
    };

    // 3) Helper : résolution des noms de matières
    async function hydrateSubjects(list: TeachClass[]) {
      const ids = Array.from(
        new Set(list.map((it) => it.subject_id).filter(Boolean) as string[])
      );
      if (!ids.length) return list;

      const nameById = new Map<string, string>();

      for (const sid of ids) {
        const { data: isub, error: subErr } = await srv
          .from("institution_subjects")
          .select("id, subject_id, custom_name, subjects:subject_id(name)")
          .or(`id.eq.${sid},subject_id.eq.${sid}`)
          .limit(1)
          .maybeSingle();

        if (subErr) {
          console.error("[grades/classes] subject lookup error", subErr);
          continue;
        }
        if (!isub) continue;

        const nm =
          (isub as any)?.custom_name ??
          (isub as any)?.subjects?.name ??
          null;

        if (!nm) continue;

        const instId = String((isub as any).id);
        const subjId = String((isub as any).subject_id);
        nameById.set(instId, nm);
        nameById.set(subjId, nm);
      }

      return list.map((it) => ({
        ...it,
        subject_name: it.subject_id
          ? nameById.get(it.subject_id) ?? it.subject_name
          : it.subject_name,
      }));
    }

    /* ───────── Mode PROF ───────── */
    if (isTeacher) {
      const { data: rows, error } = await supabase
        .from("class_teachers")
        .select("class_id,subject_id,classes:class_id(label,level)")
        .eq("teacher_id", profile.id)
        .eq("institution_id", profile.institution_id)
        .is("end_date", null);

      if (error) {
        console.error("[grades/classes] teacher class_teachers error", error);
      } else {
        (rows ?? []).forEach((row: any) => {
          const cls = row.classes || {};
          if (!row.class_id || !cls) return;
          pushUnique({
            class_id: row.class_id,
            class_label: String(cls.label ?? "—"),
            level: String(cls.level ?? "—"),
            subject_id: row.subject_id || null,
            subject_name: null,
          });
        });
      }
    }

    /* ───────── Mode COMPTE CLASSE ───────── */
    if (!isTeacher && isClassDevice) {
      const phone = (profile as any).phone as string | null;
      if (!phone) {
        const hydrated = await hydrateSubjects(items);
        return NextResponse.json({ mode: "class_device", items: hydrated });
      }

      // 1) Classes liées à ce téléphone (class_phone_e164 ou device_phone_e164)
      const { data: clsByClassPhone, error: clsErr1 } = await srv
        .from("classes")
        .select(
          "id,label,level,academic_year,institution_id,class_phone_e164,device_phone_e164"
        )
        .eq("institution_id", profile.institution_id)
        .eq("class_phone_e164", phone);

      if (clsErr1) {
        console.error("[grades/classes] classes by class_phone error", clsErr1);
      }

      const { data: clsByDevicePhone, error: clsErr2 } = await srv
        .from("classes")
        .select(
          "id,label,level,academic_year,institution_id,class_phone_e164,device_phone_e164"
        )
        .eq("institution_id", profile.institution_id)
        .eq("device_phone_e164", phone);

      if (clsErr2) {
        console.error("[grades/classes] classes by device_phone error", clsErr2);
      }

      const clsListRaw = [...(clsByClassPhone ?? []), ...(clsByDevicePhone ?? [])];

      const classById = new Map<string, any>();
      const classIds: string[] = [];
      for (const c of clsListRaw) {
        if (!c.id) continue;
        if (!classById.has(c.id)) {
          classById.set(c.id, c);
          classIds.push(c.id);
        }
      }

      if (classIds.length) {
        const { data: ctRows, error: ctErr } = await srv
          .from("class_teachers")
          .select("class_id,subject_id")
          .in("class_id", classIds)
          .eq("institution_id", profile.institution_id)
          .is("end_date", null);

        if (ctErr) {
          console.error("[grades/classes] class_device class_teachers error", ctErr);
        } else {
          (ctRows ?? []).forEach((row: any) => {
            const cls = classById.get(row.class_id);
            if (!cls) return;
            pushUnique({
              class_id: row.class_id,
              class_label: String(cls.label ?? "—"),
              level: String(cls.level ?? "—"),
              subject_id: row.subject_id || null,
              subject_name: null,
            });
          });
        }
      }

      const hydrated = await hydrateSubjects(items);
      return NextResponse.json({ mode: "class_device", items: hydrated });
    }

    // ───────── Mode par défaut (autres rôles) ─────────
    const mode: Mode =
      isTeacher ? "teacher" : isClassDevice ? "class_device" : "other";

    const hydrated = await hydrateSubjects(items);
    return NextResponse.json({ mode, items: hydrated });
  } catch (e: any) {
    console.error("[grades/classes] unexpected", e);
    return NextResponse.json({ mode: null, items: [] as TeachClass[] }, { status: 500 });
  }
}

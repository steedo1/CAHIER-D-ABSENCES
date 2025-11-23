// src/app/api/grades/roster/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RosterItem = {
  id: string;
  full_name: string;
  matricule: string | null;
};

type RoleRow = { role: string };

export async function GET(req: NextRequest) {
  try {
    const supa = await getSupabaseServerClient();
    const {
      data: { user },
    } = await supa.auth.getUser();

    if (!user) {
      return NextResponse.json({ items: [] as RosterItem[] }, { status: 401 });
    }

    const url = new URL(req.url);
    const classId = url.searchParams.get("class_id") || "";
    if (!classId) {
      return NextResponse.json({ items: [] as RosterItem[] }, { status: 200 });
    }

    // Profil + établissement + téléphone
    const { data: profile, error: profErr } = await supa
      .from("profiles")
      .select("id,institution_id,phone")
      .eq("id", user.id)
      .maybeSingle();

    if (profErr) {
      console.error("[grades/roster] profile error", profErr);
      return NextResponse.json({ items: [] as RosterItem[] }, { status: 200 });
    }
    if (!profile?.institution_id) {
      return NextResponse.json({ items: [] as RosterItem[] }, { status: 200 });
    }

    // Rôles
    const { data: roles, error: rolesErr } = await supa
      .from("user_roles")
      .select("role")
      .eq("profile_id", profile.id)
      .eq("institution_id", profile.institution_id);

    if (rolesErr) {
      console.error("[grades/roster] roles error", rolesErr);
    }

    const roleSet = new Set<string>((roles ?? []).map((r: RoleRow) => r.role));
    const isTeacher = roleSet.has("teacher");
    const isClassDevice = roleSet.has("class_device");
    const isAdmin =
      roleSet.has("admin") ||
      roleSet.has("super_admin") ||
      roleSet.has("educator");

    const srv = getSupabaseServiceClient();

    // Vérifier que la classe est bien dans l'établissement du profil
    const { data: cls, error: clsErr } = await srv
      .from("classes")
      .select("id,institution_id,class_phone_e164,device_phone_e164")
      .eq("id", classId)
      .maybeSingle();

    if (clsErr) {
      console.error("[grades/roster] class fetch error", clsErr);
      return NextResponse.json({ items: [] as RosterItem[] }, { status: 200 });
    }
    if (!cls || cls.institution_id !== profile.institution_id) {
      // Classe non trouvée ou autre établissement
      return NextResponse.json({ items: [] as RosterItem[] }, { status: 200 });
    }

    // Vérifier les droits d'accès
    let allowed = false;

    // Admin / super_admin / educator : accès direct
    if (isAdmin) {
      allowed = true;
    }

    // Prof : doit être affecté à la classe
    if (!allowed && isTeacher) {
      const { data: ctRows, error: ctErr } = await srv
        .from("class_teachers")
        .select("id")
        .eq("class_id", classId)
        .eq("teacher_id", profile.id)
        .eq("institution_id", profile.institution_id)
        .is("end_date", null)
        .limit(1);

      if (ctErr) {
        console.error("[grades/roster] class_teachers check error", ctErr);
      } else if (ctRows && ctRows.length > 0) {
        allowed = true;
      }
    }

    // Compte-classe : téléphone de la classe ou device
    if (!allowed && isClassDevice) {
      const phone = (profile as any).phone as string | null;
      if (phone && (cls.class_phone_e164 === phone || cls.device_phone_e164 === phone)) {
        allowed = true;
      }
    }

    if (!allowed) {
      // On renvoie vide, mais sans 403 pour ne pas bloquer l'UI
      return NextResponse.json({ items: [] as RosterItem[] }, { status: 200 });
    }

    // Récupérer les élèves de la classe
    const { data: enrolls, error: enrErr } = await srv
      .from("class_enrollments")
      .select(
        "student_id, students:student_id(id, first_name, last_name, matricule)"
      )
      .eq("class_id", classId)
      .eq("institution_id", profile.institution_id)
      .is("end_date", null);

    if (enrErr) {
      console.error("[grades/roster] enrollments error", enrErr);
      return NextResponse.json({ items: [] as RosterItem[] }, { status: 200 });
    }

    const items: RosterItem[] = (enrolls ?? [])
      .map((row: any) => {
        const st = row.students || {};
        const last = (st.last_name as string | null) ?? "";
        const first = (st.first_name as string | null) ?? "";

        const fullName =
          [last, first].filter((x) => !!x && x.trim().length > 0).join(" ").trim() || "—";

        const matricule = (st.matricule as string | null) ?? null;

        return {
          id: row.student_id as string,
          full_name: fullName,
          matricule,
        };
      })
      // Tri alphabétique par nom pour un affichage propre
      .sort((a, b) => a.full_name.localeCompare(b.full_name, "fr"));

    return NextResponse.json({ items });
  } catch (e: any) {
    console.error("[grades/roster] unexpected error", e);
    return NextResponse.json({ items: [] as RosterItem[] }, { status: 500 });
  }
}

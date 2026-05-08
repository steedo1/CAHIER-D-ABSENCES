import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanLabel(value: unknown): string {
  return String(value || "").trim();
}

function hhmm(value: unknown): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return raw;

  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

async function guardAdmin() {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const {
    data: { user },
    error: userErr,
  } = await supa.auth.getUser();

  if (userErr) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, error: "auth_failed", message: userErr.message },
        { status: 401 }
      ),
    };
  }

  if (!user) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, error: "unauthorized", message: "Utilisateur non connecté." },
        { status: 401 }
      ),
    };
  }

  const { data: me, error: meErr } = await supa
    .from("profiles")
    .select("id,institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (meErr) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, error: "profile_failed", message: meErr.message },
        { status: 400 }
      ),
    };
  }

  const institutionId = me?.institution_id ? String(me.institution_id) : "";

  if (!institutionId) {
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          ok: false,
          error: "no_institution",
          message: "Aucune institution associée à ce compte.",
        },
        { status: 400 }
      ),
    };
  }

  const { data: roleRow, error: roleErr } = await supa
    .from("user_roles")
    .select("role")
    .eq("profile_id", user.id)
    .eq("institution_id", institutionId)
    .maybeSingle();

  if (roleErr) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, error: "role_failed", message: roleErr.message },
        { status: 400 }
      ),
    };
  }

  const role = String(roleRow?.role || "");

  if (!["admin", "super_admin"].includes(role)) {
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          ok: false,
          error: "forbidden",
          message: "Droits insuffisants pour accéder au montage emploi du temps.",
        },
        { status: 403 }
      ),
    };
  }

  return {
    ok: true as const,
    srv,
    userId: user.id,
    institutionId,
  };
}

export async function GET() {
  try {
    const guard = await guardAdmin();
    if (!guard.ok) return guard.response;

    const { srv, institutionId } = guard;

    const [
      institutionRes,
      classesRes,
      subjectsRes,
      periodsRes,
      affectationsRes,
    ] = await Promise.all([
      srv
        .from("institutions")
        .select("id,name,acronym,tz,default_session_minutes")
        .eq("id", institutionId)
        .maybeSingle(),

      srv
        .from("classes")
        .select("id,label")
        .eq("institution_id", institutionId)
        .order("label", { ascending: true }),

      srv
        .from("institution_subjects")
        .select("id,custom_name,subjects:subject_id(name,code)")
        .eq("institution_id", institutionId)
        .order("custom_name", { ascending: true }),

      srv
        .from("institution_periods")
        .select("id,weekday,period_no,label,start_time,end_time,duration_min")
        .eq("institution_id", institutionId)
        .order("weekday", { ascending: true })
        .order("period_no", { ascending: true }),

      srv
        .from("class_teachers")
        .select(
          `
          teacher_id,
          class_id,
          subject_id,
          end_date,
          teacher:profiles(id,display_name,email,phone),
          class:classes(id,label),
          instsub:institution_subjects(
            id,
            custom_name,
            subj:subjects(id,name,code)
          )
        `
        )
        .eq("institution_id", institutionId)
        .is("end_date", null)
        .limit(10000),
    ]);

    const firstError =
      institutionRes.error ||
      classesRes.error ||
      subjectsRes.error ||
      periodsRes.error ||
      affectationsRes.error;

    if (firstError) {
      return NextResponse.json(
        {
          ok: false,
          error: "bootstrap_failed",
          message: firstError.message,
        },
        { status: 400 }
      );
    }

    const institution = institutionRes.data;

    const classes = (classesRes.data || []).map((item: any) => ({
      id: String(item.id),
      label: cleanLabel(item.label),
    }));

    const subjects = (subjectsRes.data || []).map((item: any) => {
      const base =
        Array.isArray(item.subjects)
          ? item.subjects[0]?.name
          : item.subjects?.name;

      return {
        id: String(item.id),
        label: cleanLabel(item.custom_name || base || "Matière"),
      };
    });

    const affectations = (affectationsRes.data || []).map((row: any) => {
      const teacher = Array.isArray(row.teacher) ? row.teacher[0] : row.teacher;
      const cls = Array.isArray(row.class) ? row.class[0] : row.class;
      const instsub = Array.isArray(row.instsub) ? row.instsub[0] : row.instsub;
      const subj = Array.isArray(instsub?.subj) ? instsub.subj[0] : instsub?.subj;

      return {
        teacher_id: String(row.teacher_id || teacher?.id || ""),
        teacher_name: cleanLabel(teacher?.display_name || "Enseignant"),
        subject_id: row.subject_id ? String(row.subject_id) : instsub?.id ? String(instsub.id) : null,
        subject_label: cleanLabel(instsub?.custom_name || subj?.name || "Matière"),
        class_id: String(row.class_id || cls?.id || ""),
        class_label: cleanLabel(cls?.label || "Classe"),
      };
    });

    const teacherMap = new Map<
      string,
      { id: string; display_name: string; email: string | null; phone: string | null }
    >();

    for (const row of affectationsRes.data || []) {
      const teacher = Array.isArray((row as any).teacher)
        ? (row as any).teacher[0]
        : (row as any).teacher;

      const id = String((row as any).teacher_id || teacher?.id || "");
      if (!id || teacherMap.has(id)) continue;

      teacherMap.set(id, {
        id,
        display_name: cleanLabel(teacher?.display_name || "Enseignant"),
        email: teacher?.email ? String(teacher.email) : null,
        phone: teacher?.phone ? String(teacher.phone) : null,
      });
    }

    const periods = (periodsRes.data || []).map((item: any) => ({
      id: String(item.id),
      weekday: Number(item.weekday ?? 0),
      period_no: Number(item.period_no ?? 0),
      label: cleanLabel(item.label || `Séance ${item.period_no ?? ""}`),
      start_time: hhmm(item.start_time),
      end_time: hhmm(item.end_time),
      duration_min: Number(item.duration_min ?? institution?.default_session_minutes ?? 60),
    }));

    const warnings: string[] = [];

    if (classes.length === 0) {
      warnings.push("Aucune classe détectée.");
    }

    if (subjects.length === 0) {
      warnings.push("Aucune matière détectée.");
    }

    if (periods.length === 0) {
      warnings.push("Aucun créneau horaire détecté.");
    }

    if (affectations.length === 0) {
      warnings.push("Aucune affectation active enseignant-matière-classe détectée.");
    }

    return NextResponse.json({
      ok: true,
      institution: {
        id: institution?.id ? String(institution.id) : institutionId,
        name: institution?.name ?? null,
        acronym: institution?.acronym ?? null,
        tz: institution?.tz ?? "Africa/Abidjan",
        default_session_minutes: Number(institution?.default_session_minutes ?? 60),
      },
      classes,
      subjects,
      teachers: Array.from(teacherMap.values()).sort((a, b) =>
        a.display_name.localeCompare(b.display_name)
      ),
      periods,
      affectations,
      warnings,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "server_error",
        message:
          error instanceof Error
            ? error.message
            : "Erreur serveur pendant le chargement du montage emploi du temps.",
      },
      { status: 500 }
    );
  }
}

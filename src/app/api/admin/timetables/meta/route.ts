// src/app/api/admin/timetables/meta/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RoleRow = {
  role: string | null;
};

type ProfileRow = {
  institution_id: string | null;
  role?: string | null;
};

export async function GET() {
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
      .select("institution_id, role")
      .eq("id", user.id)
      .maybeSingle();

    if (meErr) {
      return NextResponse.json({ error: meErr.message }, { status: 400 });
    }

    const profile = (me ?? null) as ProfileRow | null;
    const institution_id = profile?.institution_id ?? null;

    if (!institution_id) {
      return NextResponse.json(
        {
          error: "no_institution",
          message: "Aucune institution associée à ce compte.",
        },
        { status: 400 }
      );
    }

    const { data: roleRows, error: roleErr } = await supa
      .from("user_roles")
      .select("role")
      .eq("profile_id", user.id)
      .eq("institution_id", institution_id);

    if (roleErr) {
      return NextResponse.json({ error: roleErr.message }, { status: 400 });
    }

    const roles = ((roleRows ?? []) as RoleRow[])
      .map((r) => String(r.role || "").trim())
      .filter(Boolean);

    const profileRole = String(profile?.role || "").trim();
    const isAdmin =
      ["admin", "super_admin"].includes(profileRole) ||
      roles.some((r) => ["admin", "super_admin"].includes(r));

    if (!isAdmin) {
      return NextResponse.json(
        {
          error: "forbidden",
          message: "Droits insuffisants pour consulter ces données.",
        },
        { status: 403 }
      );
    }

    const [
      { data: classes, error: classesErr },
      { data: subjects, error: subjectsErr },
      { data: teachers, error: teachersErr },
      { data: periods, error: periodsErr },
    ] = await Promise.all([
      srv
        .from("classes")
        .select("id,label")
        .eq("institution_id", institution_id)
        .order("label", { ascending: true }),

      srv
        .from("institution_subjects")
        .select("id,custom_name,subjects:subject_id(name)")
        .eq("institution_id", institution_id)
        .order("custom_name", { ascending: true }),

      // On garde la logique actuelle, mais on filtre au moins les noms vides
      srv
        .from("profiles")
        .select("id,display_name,phone")
        .eq("institution_id", institution_id)
        .order("display_name", { ascending: true }),

      srv
        .from("institution_periods")
        .select("id,weekday,period_no,start_time,end_time")
        .eq("institution_id", institution_id)
        .order("weekday", { ascending: true })
        .order("period_no", { ascending: true }),
    ]);

    if (classesErr) {
      return NextResponse.json(
        { error: "classes_failed", message: classesErr.message },
        { status: 400 }
      );
    }

    if (subjectsErr) {
      return NextResponse.json(
        { error: "subjects_failed", message: subjectsErr.message },
        { status: 400 }
      );
    }

    if (teachersErr) {
      return NextResponse.json(
        { error: "teachers_failed", message: teachersErr.message },
        { status: 400 }
      );
    }

    if (periodsErr) {
      return NextResponse.json(
        { error: "periods_failed", message: periodsErr.message },
        { status: 400 }
      );
    }

    const outClasses =
      (classes ?? []).map((c: any) => ({
        id: String(c.id),
        label: String(c.label || "").trim(),
      })) ?? [];

    const outSubjects =
      (subjects ?? []).map((s: any) => {
        let baseName = "";
        if (Array.isArray(s.subjects)) {
          baseName = s.subjects[0]?.name || "";
        } else if (s.subjects && typeof s.subjects === "object") {
          baseName = (s.subjects as any).name || "";
        }

        return {
          id: String(s.id),
          label: String(s.custom_name || baseName || "").trim(),
        };
      }) ?? [];

    const outTeachers =
      (teachers ?? [])
        .map((t: any) => ({
          id: String(t.id),
          display_name: String(t.display_name || "").trim(),
          phone: t.phone ? String(t.phone) : null,
        }))
        .filter((t) => t.display_name.length > 0) ?? [];

    const outPeriods =
      (periods ?? []).map((p: any) => ({
        id: String(p.id),
        weekday: typeof p.weekday === "number" ? p.weekday : Number(p.weekday ?? 0) || 0,
        period_no:
          typeof p.period_no === "number"
            ? p.period_no
            : Number(p.period_no ?? 0) || 0,
        start_time: p.start_time ? String(p.start_time) : null,
        end_time: p.end_time ? String(p.end_time) : null,
      })) ?? [];

    return NextResponse.json({
      classes: outClasses,
      subjects: outSubjects,
      teachers: outTeachers,
      periods: outPeriods,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: "meta_failed", message: e?.message || "Erreur serveur." },
      { status: 500 }
    );
  }
}
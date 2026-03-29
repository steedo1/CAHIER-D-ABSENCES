import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type EmploymentType = "vacataire" | "permanent";

async function resolveAdminInstitution(req: NextRequest) {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const {
    data: { user },
  } = await supa.auth.getUser();

  if (!user) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
  }

  const url = new URL(req.url);
  const inst_qs = (url.searchParams.get("institution_id") || "").trim();

  const adminInst = await srv
    .from("user_roles")
    .select("institution_id")
    .eq("profile_id", user.id)
    .eq("role", "admin");

  if (adminInst.error) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: adminInst.error.message }, { status: 400 }),
    };
  }

  const adminSet = new Set<string>(
    (adminInst.data ?? []).map((r: any) => String(r.institution_id))
  );

  let institution_id: string | null = null;

  if (inst_qs && adminSet.has(inst_qs)) {
    institution_id = inst_qs;
  } else {
    const profCtx = await srv
      .from("profiles")
      .select("institution_id")
      .eq("id", user.id)
      .maybeSingle();

    const activeInst = (profCtx.data?.institution_id as string) ?? null;

    if (activeInst && adminSet.has(activeInst)) {
      institution_id = activeInst;
    } else {
      institution_id = adminInst.data?.[0]?.institution_id ?? null;
    }
  }

  if (!institution_id) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "institution inconnue" }, { status: 400 }),
    };
  }

  return {
    ok: true as const,
    user,
    srv,
    institution_id,
  };
}

export async function GET(req: NextRequest) {
  const resolved = await resolveAdminInstitution(req);
  if (!resolved.ok) return resolved.response;

  const { srv, institution_id } = resolved;
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();

  const ur = await srv
    .from("user_roles")
    .select("profile_id")
    .eq("institution_id", institution_id)
    .eq("role", "teacher");

  if (ur.error) {
    return NextResponse.json({ error: ur.error.message }, { status: 400 });
  }

  const teacherIds = Array.from(
    new Set((ur.data ?? []).map((r: any) => String(r.profile_id)))
  );

  if (teacherIds.length === 0) {
    return NextResponse.json({ items: [] });
  }

  const pf = await srv
    .from("profiles")
    .select("id, display_name, email, phone")
    .in("id", teacherIds)
    .order("display_name", { ascending: true });

  if (pf.error) {
    return NextResponse.json({ error: pf.error.message }, { status: 400 });
  }

  const pay = await srv
    .schema("finance")
    .from("teacher_pay_profiles")
    .select("profile_id, employment_type, payroll_enabled, notes")
    .eq("institution_id", institution_id)
    .in("profile_id", teacherIds);

  if (pay.error) {
    return NextResponse.json({ error: pay.error.message }, { status: 400 });
  }

  const payMap = new Map(
    (pay.data ?? []).map((r: any) => [String(r.profile_id), r])
  );

  const items = (pf.data ?? [])
    .map((p: any) => {
      const pp = payMap.get(String(p.id));
      return {
        profile_id: String(p.id),
        display_name: (p.display_name ?? null) as string | null,
        email: (p.email ?? null) as string | null,
        phone: (p.phone ?? null) as string | null,
        employment_type:
          ((pp?.employment_type as EmploymentType | undefined) ?? "permanent") as EmploymentType,
        payroll_enabled:
          typeof pp?.payroll_enabled === "boolean" ? pp.payroll_enabled : true,
        notes: (pp?.notes ?? null) as string | null,
      };
    })
    .filter((row) => {
      if (!q) return true;
      const hay = [
        row.display_name || "",
        row.email || "",
        row.phone || "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    })
    .sort((a, b) =>
      String(a.display_name || "").localeCompare(String(b.display_name || ""))
    );

  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  const resolved = await resolveAdminInstitution(req);
  if (!resolved.ok) return resolved.response;

  const { srv, institution_id } = resolved;

  const body = (await req.json().catch(() => ({}))) as {
    profile_id?: string;
    employment_type?: EmploymentType;
    payroll_enabled?: boolean;
    notes?: string | null;
  };

  const profile_id = String(body.profile_id || "").trim();
  const employment_type =
    body.employment_type === "vacataire" ? "vacataire" : "permanent";
  const payroll_enabled =
    typeof body.payroll_enabled === "boolean" ? body.payroll_enabled : true;
  const notes =
    typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null;

  if (!profile_id) {
    return NextResponse.json({ error: "profile_id requis" }, { status: 400 });
  }

  const teacherCheck = await srv
    .from("user_roles")
    .select("profile_id")
    .eq("institution_id", institution_id)
    .eq("role", "teacher")
    .eq("profile_id", profile_id)
    .maybeSingle();

  if (teacherCheck.error) {
    return NextResponse.json({ error: teacherCheck.error.message }, { status: 400 });
  }

  if (!teacherCheck.data?.profile_id) {
    return NextResponse.json(
      { error: "Cet utilisateur n'est pas un enseignant de cet établissement." },
      { status: 400 }
    );
  }

  const up = await srv
    .schema("finance")
    .from("teacher_pay_profiles")
    .upsert(
      {
        institution_id,
        profile_id,
        employment_type,
        payroll_enabled,
        notes,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "institution_id,profile_id" }
    )
    .select("profile_id, employment_type, payroll_enabled, notes")
    .single();

  if (up.error) {
    return NextResponse.json({ error: up.error.message }, { status: 400 });
  }

  const prof = await srv
    .from("profiles")
    .select("id, display_name, email, phone")
    .eq("id", profile_id)
    .maybeSingle();

  if (prof.error) {
    return NextResponse.json({ error: prof.error.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    item: {
      profile_id,
      display_name: (prof.data?.display_name ?? null) as string | null,
      email: (prof.data?.email ?? null) as string | null,
      phone: (prof.data?.phone ?? null) as string | null,
      employment_type: up.data.employment_type as EmploymentType,
      payroll_enabled: !!up.data.payroll_enabled,
      notes: (up.data.notes ?? null) as string | null,
    },
  });
}
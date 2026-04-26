// src/app/api/admin/conduite/overrides/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

function cleanText(v: unknown) {
  return String(v ?? "").normalize("NFKC").trim();
}

function toNumber(v: unknown) {
  if (v === null || v === undefined || v === "") return NaN;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}

function firstDefined(...values: unknown[]) {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return undefined;
}

type ConductTotalMaxResult = {
  totalMax: number;
  conductPolicyMode: string | null;
  isCompositeConduct: boolean;
};

async function getConductTotalMax(
  srv: any,
  institution_id: string,
): Promise<ConductTotalMaxResult> {
  let conductPolicyMode: string | null = null;
  let isCompositeConduct = false;

  try {
    const { data: policyRow } = await srv
      .from("institution_conduct_policies")
      .select("mode,is_active")
      .eq("institution_id", institution_id)
      .maybeSingle();

    const mode = cleanText((policyRow as any)?.mode);
    const active = (policyRow as any)?.is_active !== false;

    if (active && mode) {
      conductPolicyMode = mode;
      isCompositeConduct = mode === "conduct_plus_subjects";
    }
  } catch {
    conductPolicyMode = null;
    isCompositeConduct = false;
  }

  /*
   * Si la conduite est composite :
   * Conduite finale = moyenne pondérée sur 20
   * (conduite classique normalisée + matières comme Latin/Religion).
   *
   * Donc la correction administrative doit rester sur /20,
   * même si les rubriques internes de conduite changent un jour.
   */
  if (isCompositeConduct) {
    return {
      totalMax: 20,
      conductPolicyMode,
      isCompositeConduct,
    };
  }

  try {
    const { data, error } = await srv
      .from("conduct_settings")
      .select("assiduite_max,tenue_max,moralite_max,discipline_max")
      .eq("institution_id", institution_id)
      .maybeSingle();

    if (error || !data) {
      return {
        totalMax: 20,
        conductPolicyMode,
        isCompositeConduct,
      };
    }

    const ass = Number((data as any).assiduite_max ?? 6);
    const ten = Number((data as any).tenue_max ?? 3);
    const mor = Number((data as any).moralite_max ?? 4);
    const dis = Number((data as any).discipline_max ?? 7);

    const total = ass + ten + mor + dis;

    return {
      totalMax: Number.isFinite(total) && total > 0 ? total : 20,
      conductPolicyMode,
      isCompositeConduct,
    };
  } catch {
    return {
      totalMax: 20,
      conductPolicyMode,
      isCompositeConduct,
    };
  }
}

async function getAuthContext() {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const {
    data: { user },
  } = await supa.auth.getUser();

  if (!user) {
    return {
      error: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
      srv,
      user: null,
      institution_id: null,
    };
  }

  const { data: me, error: meErr } = await supa
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (meErr) {
    return {
      error: NextResponse.json({ error: meErr.message }, { status: 400 }),
      srv,
      user,
      institution_id: null,
    };
  }

  const institution_id = (me?.institution_id as string) ?? null;

  if (!institution_id) {
    return {
      error: NextResponse.json({ error: "institution_required" }, { status: 400 }),
      srv,
      user,
      institution_id: null,
    };
  }

  return { error: null, srv, user, institution_id };
}

export async function POST(req: NextRequest) {
  const { error, srv, user, institution_id } = await getAuthContext();
  if (error) return error;

  try {
    const body = await req.json().catch(() => ({}));

    const class_id = cleanText(body.class_id);
    const student_id = cleanText(body.student_id);
    const academic_year = cleanText(body.academic_year);
    const period_code = cleanText(body.period_code);

    const from_date = cleanText(body.from_date || body.from) || null;
    const to_date = cleanText(body.to_date || body.to) || null;

    /*
     * Compatibilité ancienne + nouvelle conduite spéciale :
     * - ancien front : calculated_total
     * - nouvelle route conduite spéciale : conduct_final_avg20 / final_total / total
     *
     * On stocke toujours la valeur calculée officielle affichée au moment
     * de la correction, afin de garder une trace propre.
     */
    const calculatedRaw = toNumber(
      firstDefined(
        body.calculated_total,
        body.conduct_final_avg20,
        body.final_total,
        body.total,
      ),
    );

    const overrideRaw = toNumber(body.override_total);
    const reason = cleanText(body.reason) || "Correction administrative";

    if (!class_id) {
      return NextResponse.json({ error: "class_id_required" }, { status: 400 });
    }

    if (!student_id) {
      return NextResponse.json({ error: "student_id_required" }, { status: 400 });
    }

    if (!academic_year) {
      return NextResponse.json({ error: "academic_year_required" }, { status: 400 });
    }

    if (!period_code) {
      return NextResponse.json({ error: "period_code_required" }, { status: 400 });
    }

    const totalMaxInfo = await getConductTotalMax(srv, institution_id as string);
    const totalMax = totalMaxInfo.totalMax;

    if (!Number.isFinite(overrideRaw)) {
      return NextResponse.json({ error: "invalid_override_total" }, { status: 400 });
    }

    if (overrideRaw < 0 || overrideRaw > totalMax) {
      return NextResponse.json(
        {
          error: "override_total_out_of_range",
          message: `La moyenne finale doit être comprise entre 0 et ${totalMax}.`,
          total_max: totalMax,
          conduct_policy_mode: totalMaxInfo.conductPolicyMode,
          is_composite_conduct: totalMaxInfo.isCompositeConduct,
        },
        { status: 400 },
      );
    }

    const calculated_total = Number.isFinite(calculatedRaw)
      ? Math.max(0, Math.min(totalMax, Number(calculatedRaw.toFixed(2))))
      : 0;

    const override_total = Math.max(
      0,
      Math.min(totalMax, Number(overrideRaw.toFixed(2))),
    );

    // Vérifier que la classe appartient bien à l'établissement de l'admin.
    const { data: cls, error: clsErr } = await srv
      .from("classes")
      .select("id,institution_id")
      .eq("id", class_id)
      .maybeSingle();

    if (clsErr) {
      return NextResponse.json({ error: clsErr.message }, { status: 400 });
    }

    if (!cls || (cls as any).institution_id !== institution_id) {
      return NextResponse.json({ error: "invalid_class" }, { status: 400 });
    }

    // Vérifier que l'élève est rattaché à cette classe au moins une fois.
    // On ne filtre pas end_date ici pour permettre les périodes historiques.
    const { data: enrollment, error: enrollmentErr } = await srv
      .from("class_enrollments")
      .select("student_id")
      .eq("institution_id", institution_id)
      .eq("class_id", class_id)
      .eq("student_id", student_id)
      .limit(1)
      .maybeSingle();

    if (enrollmentErr) {
      return NextResponse.json({ error: enrollmentErr.message }, { status: 400 });
    }

    if (!enrollment) {
      return NextResponse.json({ error: "student_not_in_class" }, { status: 400 });
    }

    const now = new Date().toISOString();

    const payload = {
      institution_id,
      class_id,
      student_id,
      academic_year,
      period_code,
      from_date,
      to_date,
      calculated_total,
      override_total,
      reason,
      edited_by: user?.id ?? null,
      updated_at: now,
    };

    const { data, error: upsertErr } = await srv
      .from("conduct_average_overrides")
      .upsert(payload, {
        onConflict: "institution_id,class_id,student_id,academic_year,period_code",
      })
      .select(
        `
        id,
        institution_id,
        class_id,
        student_id,
        academic_year,
        period_code,
        from_date,
        to_date,
        calculated_total,
        override_total,
        reason,
        edited_by,
        created_at,
        updated_at
      `,
      )
      .maybeSingle();

    if (upsertErr) {
      return NextResponse.json({ error: upsertErr.message }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      total_max: totalMax,
      conduct_policy_mode: totalMaxInfo.conductPolicyMode,
      is_composite_conduct: totalMaxInfo.isCompositeConduct,
      item: data,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "unexpected_error" },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  const { error, srv, institution_id } = await getAuthContext();
  if (error) return error;

  try {
    const url = new URL(req.url);
    const body = await req.json().catch(() => ({}));

    const class_id = cleanText(body.class_id || url.searchParams.get("class_id"));
    const student_id = cleanText(
      body.student_id || url.searchParams.get("student_id"),
    );
    const academic_year = cleanText(
      body.academic_year || url.searchParams.get("academic_year"),
    );
    const period_code = cleanText(
      body.period_code || url.searchParams.get("period_code"),
    );

    if (!class_id) {
      return NextResponse.json({ error: "class_id_required" }, { status: 400 });
    }

    if (!student_id) {
      return NextResponse.json({ error: "student_id_required" }, { status: 400 });
    }

    if (!academic_year) {
      return NextResponse.json({ error: "academic_year_required" }, { status: 400 });
    }

    if (!period_code) {
      return NextResponse.json({ error: "period_code_required" }, { status: 400 });
    }

    const { data: cls, error: clsErr } = await srv
      .from("classes")
      .select("id,institution_id")
      .eq("id", class_id)
      .maybeSingle();

    if (clsErr) {
      return NextResponse.json({ error: clsErr.message }, { status: 400 });
    }

    if (!cls || (cls as any).institution_id !== institution_id) {
      return NextResponse.json({ error: "invalid_class" }, { status: 400 });
    }

    const { error: delErr } = await srv
      .from("conduct_average_overrides")
      .delete()
      .eq("institution_id", institution_id)
      .eq("class_id", class_id)
      .eq("student_id", student_id)
      .eq("academic_year", academic_year)
      .eq("period_code", period_code);

    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      deleted: true,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "unexpected_error" },
      { status: 500 },
    );
  }
}

// src/app/api/admin/conduite/rubric-overrides/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

type RubricKey = "assiduite" | "tenue" | "moralite" | "discipline";

const RUBRIC_KEYS: RubricKey[] = [
  "assiduite",
  "tenue",
  "moralite",
  "discipline",
];

function cleanText(v: unknown) {
  return String(v ?? "").normalize("NFKC").trim();
}

function toNumber(v: unknown) {
  if (v === null || v === undefined || v === "") return NaN;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}

function isRubricKey(v: unknown): v is RubricKey {
  return RUBRIC_KEYS.includes(String(v) as RubricKey);
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

async function getRubricMax(
  srv: any,
  institution_id: string,
  rubric_key: RubricKey,
) {
  try {
    const { data, error } = await srv
      .from("conduct_settings")
      .select("assiduite_max,tenue_max,moralite_max,discipline_max")
      .eq("institution_id", institution_id)
      .maybeSingle();

    const fallback = {
      assiduite: 6,
      tenue: 3,
      moralite: 4,
      discipline: 7,
    } satisfies Record<RubricKey, number>;

    if (error || !data) return fallback[rubric_key];

    const row = data as any;
    const raw =
      rubric_key === "assiduite"
        ? row.assiduite_max
        : rubric_key === "tenue"
          ? row.tenue_max
          : rubric_key === "moralite"
            ? row.moralite_max
            : row.discipline_max;

    const n = Number(raw ?? fallback[rubric_key]);
    return Number.isFinite(n) && n >= 0 ? n : fallback[rubric_key];
  } catch {
    const fallback = {
      assiduite: 6,
      tenue: 3,
      moralite: 4,
      discipline: 7,
    } satisfies Record<RubricKey, number>;
    return fallback[rubric_key];
  }
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
    const rubric_key_raw = cleanText(body.rubric_key);

    const from_date = cleanText(body.from_date || body.from) || null;
    const to_date = cleanText(body.to_date || body.to) || null;

    const calculatedRaw = toNumber(body.calculated_value);
    const overrideRaw = toNumber(body.override_value);

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
    if (!isRubricKey(rubric_key_raw)) {
      return NextResponse.json({ error: "invalid_rubric_key" }, { status: 400 });
    }
    if (!Number.isFinite(overrideRaw)) {
      return NextResponse.json({ error: "invalid_override_value" }, { status: 400 });
    }

    const max = await getRubricMax(srv, institution_id as string, rubric_key_raw);

    if (overrideRaw < 0 || overrideRaw > max) {
      return NextResponse.json(
        {
          error: "override_value_out_of_range",
          message: `La valeur doit être comprise entre 0 et ${max}.`,
          rubric_key: rubric_key_raw,
          max,
        },
        { status: 400 },
      );
    }

    const calculated_value = Number.isFinite(calculatedRaw)
      ? Math.max(0, Math.min(max, Number(calculatedRaw.toFixed(2))))
      : 0;

    const override_value = Math.max(
      0,
      Math.min(max, Number(overrideRaw.toFixed(2))),
    );

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
      rubric_key: rubric_key_raw,
      from_date,
      to_date,
      calculated_value,
      override_value,
      edited_by: user?.id ?? null,
      updated_at: now,
    };

    const { data, error: upsertErr } = await srv
      .from("conduct_rubric_overrides")
      .upsert(payload, {
        onConflict:
          "institution_id,class_id,student_id,academic_year,period_code,rubric_key",
      })
      .select(
        `
        id,
        institution_id,
        class_id,
        student_id,
        academic_year,
        period_code,
        rubric_key,
        from_date,
        to_date,
        calculated_value,
        override_value,
        edited_by,
        created_at,
        updated_at
      `,
      )
      .maybeSingle();

    if (upsertErr) {
      return NextResponse.json({ error: upsertErr.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, item: data });
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
    const rubric_key_raw = cleanText(
      body.rubric_key || url.searchParams.get("rubric_key"),
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
    if (!isRubricKey(rubric_key_raw)) {
      return NextResponse.json({ error: "invalid_rubric_key" }, { status: 400 });
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
      .from("conduct_rubric_overrides")
      .delete()
      .eq("institution_id", institution_id)
      .eq("class_id", class_id)
      .eq("student_id", student_id)
      .eq("academic_year", academic_year)
      .eq("period_code", period_code)
      .eq("rubric_key", rubric_key_raw);

    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, deleted: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "unexpected_error" },
      { status: 500 },
    );
  }
}

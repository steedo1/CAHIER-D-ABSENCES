// src/app/api/parent/payments/options/route.ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProviderCode = "orange_money" | "wave" | "mtn_momo" | "mock";

const PROVIDER_LABELS: Record<ProviderCode, string> = {
  orange_money: "Orange Money",
  wave: "Wave",
  mtn_momo: "MTN Mobile Money",
  mock: "Test interne",
};

function fullName(row: any) {
  const first = String(row?.first_name || "").trim();
  const last = String(row?.last_name || "").trim();
  return [last, first].filter(Boolean).join(" ") || row?.matricule || "Élève";
}

function moneyNumber(value: unknown) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function rid() {
  return Math.random().toString(36).slice(2, 8);
}

export async function GET(_req: NextRequest) {
  const trace = rid();
  const srv = getSupabaseServiceClient();

  try {
    const jar = await cookies();
    const deviceId = jar.get("parent_device")?.value || "";
    if (!deviceId) {
      return NextResponse.json({ items: [], message: "Session parent introuvable." });
    }

    const { data: links, error: linksErr } = await srv
      .from("parent_device_children")
      .select("student_id")
      .eq("device_id", deviceId);

    if (linksErr) {
      console.error(`[parent.payments.options:${trace}] links`, linksErr);
      return NextResponse.json({ error: linksErr.message }, { status: 400 });
    }

    const studentIds = Array.from(
      new Set((links || []).map((row: any) => String(row.student_id || "")).filter(Boolean)),
    );

    if (!studentIds.length) return NextResponse.json({ items: [] });

    const { data: students, error: studentsErr } = await srv
      .from("students")
      .select("id,first_name,last_name,matricule,institution_id")
      .in("id", studentIds);

    if (studentsErr) {
      console.error(`[parent.payments.options:${trace}] students`, studentsErr);
      return NextResponse.json({ error: studentsErr.message }, { status: 400 });
    }

    const { data: enrollments, error: enrollErr } = await srv
      .from("class_enrollments")
      .select("student_id,class_id,institution_id")
      .in("student_id", studentIds)
      .is("end_date", null);

    if (enrollErr) {
      console.error(`[parent.payments.options:${trace}] enrollments`, enrollErr);
    }

    const enrollmentByStudent = new Map<string, any>();
    for (const row of enrollments || []) {
      const sid = String((row as any).student_id || "");
      if (sid && !enrollmentByStudent.has(sid)) enrollmentByStudent.set(sid, row);
    }

    const classIds = Array.from(
      new Set((enrollments || []).map((row: any) => String(row.class_id || "")).filter(Boolean)),
    );

    const { data: classes } = classIds.length
      ? await srv
          .from("classes")
          .select("id,label,level,academic_year,institution_id")
          .in("id", classIds)
      : { data: [] as any[] };

    const classById = new Map<string, any>();
    for (const cls of classes || []) classById.set(String((cls as any).id), cls);

    const institutionIds = Array.from(
      new Set(
        (students || [])
          .map((student: any) => {
            const enrollment = enrollmentByStudent.get(String(student.id));
            const cls = enrollment?.class_id ? classById.get(String(enrollment.class_id)) : null;
            return String(cls?.institution_id || enrollment?.institution_id || student.institution_id || "");
          })
          .filter(Boolean),
      ),
    );

    const { data: institutions } = institutionIds.length
      ? await srv.from("institutions").select("id,name").in("id", institutionIds)
      : { data: [] as any[] };

    const institutionById = new Map<string, any>();
    for (const inst of institutions || []) institutionById.set(String((inst as any).id), inst);

    const { data: charges, error: chargesErr } = await srv
      .schema("finance")
      .from("v_charge_balances")
      .select(
        "id,school_id,student_id,class_id,fee_schedule_id,fee_category_id,label,net_amount,paid_amount,balance_due,due_date,computed_status",
      )
      .in("student_id", studentIds)
      .neq("computed_status", "cancelled")
      .gt("balance_due", 0)
      .order("due_date", { ascending: true, nullsFirst: false });

    if (chargesErr) {
      console.error(`[parent.payments.options:${trace}] charges`, chargesErr);
      return NextResponse.json({ error: chargesErr.message }, { status: 400 });
    }

    let accounts: any[] = [];
    if (institutionIds.length) {
      const { data: accRows, error: accErr } = await srv
        .schema("finance")
        .from("institution_payment_accounts")
        .select("id,school_id,provider,display_name,environment,is_active")
        .in("school_id", institutionIds)
        .eq("is_active", true);

      if (accErr) {
        console.warn(`[parent.payments.options:${trace}] payment accounts indisponibles`, accErr.message);
      } else {
        accounts = accRows || [];
      }
    }

    const chargesByStudent = new Map<string, any[]>();
    for (const charge of charges || []) {
      const sid = String((charge as any).student_id || "");
      if (!chargesByStudent.has(sid)) chargesByStudent.set(sid, []);
      chargesByStudent.get(sid)!.push({
        id: String((charge as any).id),
        label: String((charge as any).label || "Frais scolaire"),
        net_amount: moneyNumber((charge as any).net_amount),
        paid_amount: moneyNumber((charge as any).paid_amount),
        balance_due: moneyNumber((charge as any).balance_due),
        due_date: (charge as any).due_date || null,
        status: (charge as any).computed_status || "pending",
      });
    }

    const accountsBySchool = new Map<string, any[]>();
    for (const account of accounts) {
      const schoolId = String(account.school_id || "");
      if (!accountsBySchool.has(schoolId)) accountsBySchool.set(schoolId, []);
      accountsBySchool.get(schoolId)!.push({
        id: String(account.id),
        provider: String(account.provider),
        label:
          PROVIDER_LABELS[String(account.provider) as ProviderCode] ||
          String(account.display_name || "").trim() ||
          String(account.provider || "Paiement"),
        environment: String(account.environment || "test"),
      });
    }

    const items = (students || []).map((student: any) => {
      const sid = String(student.id);
      const enrollment = enrollmentByStudent.get(sid);
      const cls = enrollment?.class_id ? classById.get(String(enrollment.class_id)) : null;
      const institutionId = String(
        cls?.institution_id || enrollment?.institution_id || student.institution_id || "",
      );
      const inst = institutionById.get(institutionId);

      return {
        student_id: sid,
        student_name: fullName(student),
        matricule: student.matricule || null,
        class_id: cls?.id || enrollment?.class_id || null,
        class_label: cls?.label || null,
        institution_id: institutionId || null,
        institution_name: inst?.name || "Établissement",
        charges: chargesByStudent.get(sid) || [],
        providers: institutionId ? accountsBySchool.get(institutionId) || [] : [],
      };
    });

    return NextResponse.json({ items });
  } catch (e: any) {
    console.error(`[parent.payments.options:${trace}] fatal`, e);
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}

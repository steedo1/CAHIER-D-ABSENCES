import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export type FinanceChargeBalanceRow = {
  id: string;
  school_id?: string;
  academic_year_id?: string | null;
  academic_year?: string | null;
  student_id: string;
  class_id: string | null;
  fee_schedule_id?: string | null;
  fee_category_id?: string;
  label: string;
  base_amount?: number | string;
  adjustment_total?: number | string;
  net_amount: number | string;
  paid_amount: number | string;
  balance_due: number | string;
  due_date: string | null;
  charge_date?: string;
  computed_status: "pending" | "partial" | "paid" | "overdue" | "cancelled";
  created_at?: string;
  updated_at?: string;
};

export const FULL_CHARGE_BALANCE_SELECT =
  "id,school_id,academic_year_id,student_id,class_id,fee_schedule_id,fee_category_id,label,base_amount,adjustment_total,net_amount,paid_amount,balance_due,due_date,charge_date,computed_status,created_at,updated_at";

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
}

function chunkStrings(items: string[], size = 400): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function fetchFinanceChargeBalancesByClasses({
  institutionIds,
  classIds,
  select = FULL_CHARGE_BALANCE_SELECT,
  onlyOpen = false,
  orderByDueDate = false,
  pageSize = 1000,
}: {
  institutionIds: string[];
  classIds: string[];
  select?: string;
  onlyOpen?: boolean;
  orderByDueDate?: boolean;
  pageSize?: number;
}): Promise<FinanceChargeBalanceRow[]> {
  const schoolIds = uniqueStrings(institutionIds);
  const targetClassIds = uniqueStrings(classIds);

  if (schoolIds.length === 0 || targetClassIds.length === 0) return [];

  const admin = getSupabaseServiceClient();
  const rows: FinanceChargeBalanceRow[] = [];
  const safePageSize = Math.max(1, Math.min(pageSize, 1000));

  for (const classPart of chunkStrings(targetClassIds)) {
    for (let from = 0; ; from += safePageSize) {
      const to = from + safePageSize - 1;
      let query: any = admin
        .schema("finance")
        .from("v_charge_balances")
        .select(select)
        .in("class_id", classPart)
        .neq("computed_status", "cancelled");

      if (schoolIds.length === 1) {
        query = query.eq("school_id", schoolIds[0]);
      } else {
        query = query.in("school_id", schoolIds);
      }

      if (onlyOpen) {
        query = query.gt("balance_due", 0);
      }

      if (orderByDueDate) {
        query = query.order("due_date", { ascending: true, nullsFirst: false });
      }

      const { data, error } = await query.range(from, to);

      if (error) throw new Error(error.message);

      const pageRows = (data ?? []) as FinanceChargeBalanceRow[];
      rows.push(...pageRows);

      if (pageRows.length < safePageSize) break;
    }
  }

  return rows;
}

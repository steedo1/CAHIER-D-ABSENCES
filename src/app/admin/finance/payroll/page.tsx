import PayrollPageImpl from "./_impl";
import PayrollInteractiveBehavior from "./PayrollInteractiveBehavior";

export const dynamic = "force-dynamic";

type PayrollSearchParams = {
  month?: string;
  rate_first?: string;
  rate_second?: string;
  run_id?: string;
  print?: string;
  autoprint?: string;
  academic_year?: string;
  late_tolerance_min?: string;
  early_departure_tolerance_min?: string;
  session_reference_minutes?: string;
  message?: string;
};

export default async function FinancePayrollPage({
  searchParams,
}: {
  searchParams?: Promise<PayrollSearchParams>;
}) {
  return (
    <PayrollInteractiveBehavior>
      <PayrollPageImpl searchParams={searchParams} />
    </PayrollInteractiveBehavior>
  );
}

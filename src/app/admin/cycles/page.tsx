import { isSchoolCycle } from "@/lib/school-cycles";
import CycleOverviewClient from "./CycleOverviewClient";

export const dynamic = "force-dynamic";

export default async function CyclesPage({
  searchParams,
}: {
  searchParams: Promise<{ cycle?: string }>;
}) {
  const params = await searchParams;
  const selected = isSchoolCycle(params.cycle) ? params.cycle : null;

  return <CycleOverviewClient initialCycle={selected} />;
}

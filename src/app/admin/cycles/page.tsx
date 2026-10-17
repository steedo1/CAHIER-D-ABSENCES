import { isSchoolCycle } from "@/lib/school-cycles";
import CycleOverviewClient from "./CycleOverviewClient";

export const dynamic = "force-dynamic";

export default async function CyclesPage({
  searchParams,
}: {
  searchParams: Promise<{ cycle?: string; school_cycle?: string }>;
}) {
  const params = await searchParams;
  const requested = params.school_cycle || params.cycle;
  const selected = isSchoolCycle(requested) ? requested : null;

  return <CycleOverviewClient initialCycle={selected} />;
}

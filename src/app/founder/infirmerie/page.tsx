// src/app/founder/infirmerie/page.tsx
import InfirmaryStatsDashboard from "@/components/infirmary/InfirmaryStatsDashboard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function FounderInfirmaryPage() {
  return <InfirmaryStatsDashboard audience="founder" />;
}

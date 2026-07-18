import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { loadFounderAttendancePayload } from "@/lib/founder-attendance-slots-server";
import FounderAttendanceSlotsClient from "./client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function FounderAttendanceSlotsPage() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  try {
    const initialData = await loadFounderAttendancePayload(user.id);
    return <FounderAttendanceSlotsClient initialData={initialData} />;
  } catch (error: any) {
    if (String(error?.message || error) === "no_institution") redirect("/profile");
    const now = new Date();
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Abidjan",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    const nowLabel = new Intl.DateTimeFormat("fr-FR", {
      timeZone: "Africa/Abidjan",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(now);
    return (
      <FounderAttendanceSlotsClient
        initialData={{
          source: "cache",
          generated_at: now.toISOString(),
          today,
          nowLabel,
          rows: [],
          totals: { schools: 0, activeSchools: 0, expected: 0, present: 0, permissionnaire: 0, absent: 0 },
        }}
      />
    );
  }
}

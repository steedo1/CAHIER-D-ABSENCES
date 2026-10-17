export const dynamic = "force-dynamic";
export const revalidate = 0;

import AdminDashboardClient from "./client";
import { redirect } from "next/navigation";
import { getSchoolNavigationSettings } from "@/lib/server/school-navigation";
import { readSchoolNavigation, withSchoolNavigation } from "@/lib/school-navigation";
import { getSchoolAdminNavigation } from "@/lib/school-cycles";

export default async function AdminDashboard({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const settings = (await getSchoolNavigationSettings())?.settings;
  if (settings?.enabled && settings.enabledCycles.length === 1) {
    const params = await searchParams;
    const query = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
    const requested = readSchoolNavigation(query);
    const navigation = getSchoolAdminNavigation(settings);
    redirect(withSchoolNavigation("/admin/cycles", {
      cycle: navigation.landingCycle,
      track: requested.track && requested.track !== "all" && navigation.availableTracks.includes(requested.track)
        ? requested.track : navigation.availableTracks.length === 1 ? navigation.availableTracks[0] : "all",
      level: requested.level || "", classId: requested.classId || "",
    }));
  }
  return <AdminDashboardClient />;
}



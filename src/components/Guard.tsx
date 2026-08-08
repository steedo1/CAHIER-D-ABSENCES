"use client";

import { useAuth } from "@/app/providers";
import { probeCloudSchedule } from "@/lib/cloud-availability";
import {
  readOfflineLoginSession,
  type OfflineLoginRole,
} from "@/lib/offline-auth";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

function isOfflineProtectedPath(pathname: string) {
  return (
    pathname === "/choose-book" ||
    pathname === "/attendance" ||
    pathname === "/class" ||
    pathname.startsWith("/class/") ||
    pathname === "/grades" ||
    pathname === "/grades/class-device" ||
    pathname === "/enseignant/cahier-de-texte" ||
    pathname === "/parents" ||
    pathname === "/admin/bulletins" ||
    pathname === "/admin/communication" ||
    pathname === "/admin/dashboard" ||
    pathname === "/admin/absences/appels" ||
    pathname === "/admin/absences/appels-matrice" ||
    pathname === "/founder/attendance-slots"
  );
}

function roleAllowsPath(role: OfflineLoginRole, pathname: string) {
  if (pathname === "/choose-book" || pathname === "/enseignant/cahier-de-texte") {
    return true;
  }
  if (role === "teacher") {
    return pathname === "/attendance" || pathname === "/grades";
  }
  return (
    pathname === "/class" ||
    pathname.startsWith("/class/") ||
    pathname === "/grades/class-device"
  );
}

export default function Guard({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const protectedOfflinePath = isOfflineProtectedPath(pathname);
  const [offlineAuthorized, setOfflineAuthorized] = useState(
    !protectedOfflinePath,
  );

  // Une session Supabase mémorisée ne doit pas envoyer vers /redirect
  // lorsque le Cloud est indisponible : /redirect est une route serveur.
  useEffect(() => {
    if (loading || !session || pathname !== "/login") return;
    let cancelled = false;
    void probeCloudSchedule().then((reachable) => {
      if (!cancelled && reachable) router.replace("/redirect");
    });
    return () => {
      cancelled = true;
    };
  }, [loading, session, pathname, router]);

  useEffect(() => {
    if (!protectedOfflinePath) {
      setOfflineAuthorized(true);
      return;
    }
    if (loading) {
      setOfflineAuthorized(false);
      return;
    }
    if (session) {
      setOfflineAuthorized(true);
      return;
    }

    const offlineSession = readOfflineLoginSession();
    if (
      offlineSession &&
      roleAllowsPath(offlineSession.role, pathname)
    ) {
      setOfflineAuthorized(true);
      return;
    }

    setOfflineAuthorized(false);
    // Navigation documentaire : le service worker peut servir /login depuis
    // son cache même lorsque Next.js ne peut plus récupérer de flux RSC.
    window.location.replace("/login");
  }, [loading, pathname, protectedOfflinePath, session]);

  if (protectedOfflinePath && (loading || !offlineAuthorized)) return null;
  return <>{children}</>;
}

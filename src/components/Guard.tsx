"use client";

import { useAuth } from "@/app/providers";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

const PUBLIC_ROUTES = new Set<string>(["/login", "/recover", "/redirect"]);

export default function Guard({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  // Si connectÃ© et sur /login â‡’ bascule vers /redirect
  useEffect(() => {
    if (loading) return;
    if (session && pathname === "/login") {
      router.replace("/redirect");
    }
  }, [loading, session, pathname, router]);

  // âœ… On laisse le middleware protÃ©ger le reste (pas de double redirection ici)
  if (loading) return null;

  return <>{children}</>;
}

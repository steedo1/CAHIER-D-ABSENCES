// src/app/login/page.tsx
"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import LoginCard from "@/components/auth/LoginCard";

const DEBUG = true;

export default function LoginPage() {
  const sp = useSearchParams();
  const bookParam = sp.get("book");
  const spaceParam = sp.get("space"); // "direction" | "enseignant" | null

  const book =
    bookParam === "grades" || bookParam === "attendance"
      ? (bookParam as "grades" | "attendance")
      : undefined;

  const space =
    spaceParam === "direction" || spaceParam === "enseignant"
      ? spaceParam
      : undefined;

  // 👉 On ne propage book que s'il existe vraiment
  const redirectTo = book ? `/redirect?book=${book}` : "/redirect";

  // 👉 Forçage du mode de connexion
  const forcedMode =
    space === "direction"
      ? ("emailOnly" as const)
      : space === "enseignant"
      ? ("phoneOnly" as const)
      : undefined;

  const headerLabel =
    space === "direction"
      ? "Espace Direction — Absences & Notes"
      : space === "enseignant"
      ? "Espace Enseignant — Absences & Notes"
      : book === "grades"
      ? "Mon Cahier de Notes"
      : "Mon Cahier d’Absences";

  useEffect(() => {
    if (!DEBUG) return;
    console.log("[LOGIN/page] mount", { book, redirectTo, space, forcedMode });
    return () =>
      console.log("[LOGIN/page] unmount", { book, redirectTo, space });
  }, [book, redirectTo, space, forcedMode]);

  return (
    <main className="relative min-h-screen">
      {/* ======== Image de fond + filtre ======== */}
      <div
        aria-hidden
        className="absolute inset-0 -z-20 bg-cover bg-center"
        style={{ backgroundImage: "url(/admin.png)" }}
      />
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-gradient-to-b from-black/40 via-black/10 to-white/70 md:bg-gradient-to-r md:from-black/50 md:via-black/10 md:to-white/70"
      />

      {/* ======== Contenu ======== */}
      <div className="relative z-0 mx-auto max-w-7xl px-4 py-10">
        <header className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-sky-700 text-white shadow-sm">
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path d="M4 6h16M4 12h16M4 18h10" />
              </svg>
            </div>
            <span className="text-sm font-semibold text-white drop-shadow">
              {headerLabel}
            </span>
          </div>
        </header>

        <section className="mx-auto max-w-md">
          {/* On propage le choix du cahier jusqu'à /redirect (si présent) */}
          <LoginCard redirectTo={redirectTo} forcedMode={forcedMode} />
          <footer className="mt-6 text-center text-xs text-white/80 drop-shadow-sm">
            © {new Date().getFullYear()} Mon Cahier — Tous droits réservés
          </footer>
        </section>
      </div>
    </main>
  );
}

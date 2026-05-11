// src/app/login/page.tsx
"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import LoginCard from "@/components/auth/LoginCard";

/* ───────── Composant interne qui utilise useSearchParams ───────── */

function LoginPageInner() {
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

  // On ne propage book que s'il existe vraiment.
  const redirectTo = book ? `/redirect?book=${book}` : "/redirect";

  // Forçage du mode de connexion selon l’espace choisi.
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
      : "Mon Cahier d’Absences & de Notes";

  return (
    <main className="relative min-h-screen overflow-hidden">
      {/* ======== Image de fond + filtre ======== */}
      <div
        aria-hidden
        className="absolute inset-0 -z-20 bg-cover bg-center"
        style={{ backgroundImage: "url(/admin.png)" }}
      />
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-gradient-to-b from-black/45 via-black/15 to-white/75 md:bg-gradient-to-r md:from-black/55 md:via-black/15 md:to-white/75"
      />

      {/* ======== Contenu ======== */}
      <div className="relative z-0 mx-auto flex min-h-screen max-w-7xl flex-col px-4 py-6 md:py-10">
        <header className="mb-6 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="relative h-10 w-10 shrink-0 rounded-xl bg-white/10 p-1.5 shadow-sm backdrop-blur-sm md:h-12 md:w-12">
              <Image
                src="/nexa-digital-logo.png"
                alt="NEXA DIGITAL FOR EDUCATION"
                fill
                className="object-contain"
                priority
              />
            </div>
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-semibold text-white drop-shadow md:text-base">
                NEXA DIGITAL FOR EDUCATION
              </span>
              <span className="truncate text-[11px] text-white/85 drop-shadow md:text-xs">
                {headerLabel}
              </span>
            </div>
          </div>

          {/* ✅ Retour demandé : la page login permet maintenant de revenir au Home. */}
          <Link
            href="/"
            className="inline-flex shrink-0 items-center justify-center rounded-2xl border border-white/30 bg-white/15 px-3 py-2 text-xs font-semibold text-white shadow-sm backdrop-blur transition hover:bg-white/25 focus:outline-none focus:ring-4 focus:ring-white/25 md:px-4 md:text-sm"
          >
            ← Accueil
          </Link>
        </header>

        <section className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-4">
          {/* On propage le choix du cahier jusqu'à /redirect (si présent). */}
          <LoginCard redirectTo={redirectTo} forcedMode={forcedMode} />
          <footer className="mt-6 text-center text-xs text-white/85 drop-shadow-sm">
            © {new Date().getFullYear()} NEXA DIGITAL SARL — Tous droits réservés
          </footer>
        </section>
      </div>
    </main>
  );
}

/* ───────── Page exportée, enveloppée dans un Suspense ───────── */

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-slate-50">
          <div className="rounded-xl bg-white/95 px-4 py-3 text-sm text-slate-700 shadow">
            Chargement de la page de connexion…
          </div>
        </main>
      }
    >
      <LoginPageInner />
    </Suspense>
  );
}

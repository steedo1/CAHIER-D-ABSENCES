"use client";

import { useEffect } from "react";
import LoginCard from "@/components/auth/LoginCard";

const DEBUG = true;

export default function LoginPage() {
  useEffect(() => {
    if (!DEBUG) return;
    console.log("[LOGIN/page] mount");
    return () => console.log("[LOGIN/page] unmount");
  }, []);

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
              Mon Cahier d’Absences
            </span>
          </div>
        </header>

        <section className="mx-auto max-w-md">
          <LoginCard redirectTo="/redirect" />
          <footer className="mt-6 text-center text-xs text-white/80 drop-shadow-sm">
            © {new Date().getFullYear()} Mon Cahier d’Absences — Tous droits réservés
          </footer>
        </section>
      </div>
    </main>
  );
}

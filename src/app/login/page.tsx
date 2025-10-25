// src/app/login/page.tsx
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
    <main className="min-h-screen bg-gradient-to-b from-sky-50 via-white to-white">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-6">
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
          <span className="text-sm font-semibold text-slate-700">
            Mon Cahier d’Absences
          </span>
        </div>
      </header>

      <section className="mx-auto max-w-md px-4">
        <LoginCard redirectTo="/redirect" />
        <footer className="mt-6 text-center text-xs text-slate-400">
          © {new Date().getFullYear()} Mon Cahier d’Absences — Tous droits réservés
        </footer>
      </section>
    </main>
  );
}

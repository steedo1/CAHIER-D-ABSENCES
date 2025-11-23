//src/app/choose-book/page.tsx
"use client";

import Link from "next/link";
import { Notebook, NotebookPen, ChevronRight } from "lucide-react";

export default function ChooseBookPage() {
  return (
    <main className="relative min-h-screen bg-white">
      {/* décor léger */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute left-[5%] top-[-8%] h-80 w-80 rounded-full bg-violet-300/40 blur-2xl md:h-[28rem] md:w-[28rem]" />
        <div className="absolute right-[2%] top-[10%] h-72 w-72 rounded-full bg-indigo-300/40 blur-2xl md:h-[26rem] md:w-[26rem]" />
        <div className="absolute bottom-[-10%] left-[15%] h-72 w-72 rounded-full bg-emerald-300/40 blur-2xl md:h-[26rem] md:w-[26rem]" />
      </div>

      <header className="w-full bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 py-6 text-white shadow-sm">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-white/15">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8}>
                <path d="M12 3l7 3v6c0 5-3.5 8-7 9-3.5-1-7-4-7-9V6l7-3z" />
              </svg>
            </div>
            <div>
              <div className="text-sm font-semibold uppercase tracking-wide text-white/80">Espace enseignant</div>
              <div className="text-lg font-extrabold">Choisir votre cahier</div>
            </div>
          </div>
          <Link
            href="/redirect"
            className="rounded-full bg-white/15 px-3.5 py-1.5 text-sm font-semibold text-white ring-1 ring-white/20 hover:bg-white/25"
            title="Retourner à l’application"
          >
            Retour
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-4 py-10 md:py-14">
        <p className="mx-auto max-w-2xl text-center text-slate-700">
          Sélectionnez le cahier pour démarrer. Vous pourrez changer à tout moment en revenant ici.
        </p>

        <div className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-2">
          {/* Absences */}
          <Link
            href="/redirect?book=attendance"
            className="group block rounded-3xl border border-indigo-200 bg-white p-6 shadow-sm ring-1 ring-indigo-100 transition hover:shadow-md"
          >
            <div className="flex items-start gap-4">
              <div className="grid h-12 w-12 flex-none place-items-center rounded-xl bg-indigo-600 text-white shadow-sm">
                <Notebook className="h-6 w-6" />
              </div>
              <div className="flex-1">
                <div className="text-xl font-semibold text-slate-900">Cahier des absences</div>
                <p className="mt-1 text-sm text-slate-700">
                  Appel express, retards, validation et notifications immédiates aux parents.
                </p>
                <div className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-indigo-700">
                  Continuer <ChevronRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                </div>
              </div>
            </div>
          </Link>

          {/* Notes */}
          <Link
            href="/redirect?book=grades"
            className="group block rounded-3xl border border-violet-200 bg-white p-6 shadow-sm ring-1 ring-violet-100 transition hover:shadow-md"
          >
            <div className="flex items-start gap-4">
              <div className="grid h-12 w-12 flex-none place-items-center rounded-xl bg-violet-600 text-white shadow-sm">
                <NotebookPen className="h-6 w-6" />
              </div>
              <div className="flex-1">
                <div className="text-xl font-semibold text-slate-900">Cahier de notes</div>
                <p className="mt-1 text-sm text-slate-700">
                  Évaluations, coefficients, calcul de moyennes et partage aux parents.
                </p>
                <div className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-violet-700">
                  Continuer <ChevronRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                </div>
              </div>
            </div>
          </Link>
        </div>
      </section>
    </main>
  );
}





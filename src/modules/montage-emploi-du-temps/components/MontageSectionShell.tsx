"use client";

import Link from "next/link";
import React from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Info,
  Settings2,
} from "lucide-react";

type Card = {
  title: string;
  description: string;
};

export default function MontageSectionShell({
  eyebrow = "Montage emploi du temps",
  badge,
  title,
  description,
  status = "Modèle HoraClasse",
  cards,
  children,
  note,
}: {
  eyebrow?: string;
  badge?: string;
  title: string;
  description: string;
  status?: string;
  cards?: Card[];
  children?: React.ReactNode;
  note?: string;
}) {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-7xl space-y-6">
        <Link
          href="/admin/montage-emploi-du-temps"
          className="inline-flex items-center gap-2 text-sm font-bold text-slate-600 transition hover:text-slate-950"
        >
          <ArrowLeft className="h-4 w-4" />
          Retour à la vue d’ensemble
        </Link>

        <div className="overflow-hidden rounded-[32px] border border-slate-200 bg-slate-950 shadow-xl">
          <div className="relative p-6 sm:p-8">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.22),transparent_34%),radial-gradient(circle_at_bottom_left,rgba(16,185,129,0.18),transparent_32%)]" />

            <div className="relative">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-black uppercase tracking-[0.18em] text-sky-100">
                <Settings2 className="h-4 w-4" />
                {badge || eyebrow}
              </div>

              <h1 className="mt-5 text-3xl font-black tracking-tight text-white sm:text-4xl">
                {title}
              </h1>

              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300 sm:text-base">
                {description}
              </p>

              <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-black text-slate-950">
                <Clock3 className="h-4 w-4" />
                {status}
              </div>
            </div>
          </div>
        </div>

        {cards && cards.length > 0 && (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {cards.map((card) => (
              <div
                key={card.title}
                className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
                    <CheckCircle2 className="h-6 w-6" />
                  </div>

                  <div>
                    <h2 className="font-black text-slate-950">{card.title}</h2>
                    <p className="mt-1 text-sm leading-6 text-slate-600">
                      {card.description}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {note && (
          <div className="rounded-[28px] border border-sky-200 bg-sky-50 p-6 text-sky-950 shadow-sm">
            <div className="flex items-start gap-3">
              <Info className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <h2 className="font-black">Principe HoraClasse</h2>
                <p className="mt-1 text-sm leading-6">{note}</p>
              </div>
            </div>
          </div>
        )}

        {children}
      </section>
    </main>
  );
}

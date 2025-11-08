"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./providers";

/* ───────────────────────── Helpers ───────────────────────── */
function SectionTitle(props: { id?: string; children: React.ReactNode }) {
  return (
    <h2
      id={props.id}
      className="scroll-mt-24 text-3xl font-bold tracking-tight text-slate-900 md:text-4xl"
    >
      {props.children}
    </h2>
  );
}

type FaqItem = { q: string; a: React.ReactNode };
function Accordion({ items }: { items: FaqItem[] }) {
  return (
    <div className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
      {items.map((it, i) => (
        <details key={i} className="group">
          <summary className="flex cursor-pointer list-none items-start gap-3 px-5 py-4 text-left text-base font-semibold text-slate-900 hover:bg-slate-50">
            <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 ring-1 ring-indigo-100">
              +
            </span>
            <span className="pr-2">{it.q}</span>
          </summary>
          <div className="px-14 pb-5 pt-1 text-slate-700">{it.a}</div>
        </details>
      ))}
    </div>
  );
}

function ContactCTA() {
  const wa =
    "https://wa.me/2250720672094?text=Bonjour%20Mon%20Cahier%20d%E2%80%99Absences%2C%20je%20souhaite%20m%E2%80%99abonner.";
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <a
        href={wa}
        target="_blank"
        rel="noreferrer"
        className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700"
      >
        Démarrer sur WhatsApp
      </a>
      <a
        href="tel:+2250713023762"
        className="rounded-lg bg-slate-100 px-3.5 py-1.5 text-sm font-semibold text-slate-800 ring-1 ring-slate-200 hover:bg-white"
      >
        Appeler le commercial
      </a>
      <a
        href="mailto:moncahier.ci@gmail.com"
        className="text-sm font-semibold text-indigo-700 hover:underline"
      >
        moncahier.ci@gmail.com
      </a>
    </div>
  );
}

/* ───────────────────────── Page ───────────────────────── */
export default function HomePage() {
  const { session } = useAuth();
  const router = useRouter();
  const redirectedRef = useRef(false);

  // Si déjà connecté (admin/enseignant), on redirige vers l’app
  useEffect(() => {
    if (session && !redirectedRef.current) {
      redirectedRef.current = true;
      router.replace("/redirect");
    }
  }, [session, router]);

  const subscribeFaq: FaqItem[] = [
    {
      q: "Comment s’abonner à Mon Cahier d’Absences ?",
      a: (
        <>
          L’abonnement se fait directement avec notre équipe. Les établissements restent
          <b> autonomes</b> ensuite pour créer classes, enseignants et lier les parents.
          <ContactCTA />
        </>
      ),
    },
    {
      q: "Quelles fonctionnalités sont incluses dès l’abonnement ?",
      a: (
        <ul className="ml-5 list-disc space-y-1">
          <li>
            Création autonome des <b>classes</b> et des <b>comptes enseignants</b>.
          </li>
          <li>
            Contacts parents reliés aux élèves, <b>notifications temps réel</b> (absence/retard).
          </li>
          <li>
            <b>Suivi des heures effectuées</b> par enseignant sur une période donnée.
          </li>
          <li>
            <b>Tableau de bord</b> clair ; exports CSV.
          </li>
          <li>Import facile (CSV) des <b>classes</b> et <b>enseignants</b>.</li>
          <li>
            Affectations <b>en masse</b> : créer et associer des <b>disciplines</b> aux
            enseignants en un coup.
          </li>
          <li>
            Rôles clairs : super admin, admin d’établissement, enseignant, parent —{" "}
            <b>une seule vue par rôle</b>.
          </li>
        </ul>
      ),
    },
  ];

  const manageFaq: FaqItem[] = [
    {
      q: "Comment suivre l’échéance et la situation de mon abonnement ?",
      a: (
        <>
          Dans <b>Paramètres → Abonnement</b>, vous voyez l’échéance et l’historique des
          paiements.
        </>
      ),
    },
    {
      q: "Comment sont envoyées les notifications aux parents ?",
      a: (
        <>
          Lors de la validation de l’appel, le parent est notifié <b>immédiatement</b>.
        </>
      ),
    },
  ];

  return (
    <main className="relative min-h-screen bg-white">
      {/* Header avec 2 boutons : Parent / Établissement */}
      <header className="sticky top-0 z-30 w-full border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-indigo-600 text-white">
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
              >
                <path d="M12 3l7 3v6c0 5-3.5 8-7 9-3.5-1-7-4-7-9V6l7-3z" />
              </svg>
            </div>
            <div className="text-slate-900">
              <div className="text-sm font-semibold tracking-wide">
                Mon Cahier d’Absences
              </div>
              <div className="text-xs text-slate-500">
                Portail Parents & Établissements
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <a
              href="/parents/login"
              className="rounded-full bg-emerald-600 px-3.5 py-1.5 text-sm font-semibold text-white shadow hover:bg-emerald-700"
            >
              Espace parent
            </a>
            <a
              href="/login"
              className="rounded-full bg-indigo-600 px-3.5 py-1.5 text-sm font-semibold text-white shadow hover:bg-indigo-700"
            >
              Espace établissement
            </a>
          </div>
        </div>
      </header>

      {/* HERO */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute -left-32 top-0 h-[520px] w-[520px] -translate-y-10 rounded-full bg-fuchsia-300/40 blur-md md:-left-40 md:h-[680px] md:w-[680px]" />
        <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-8 px-4 py-10 md:grid-cols-2 md:py-16">
          <div className="relative z-10">
            <h1 className="text-4xl font-extrabold leading-tight text-slate-900 md:text-6xl">
              Le cahier d’absences <span className="text-indigo-600">numérique</span>
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-slate-700">
              Appel rapide, alertes parents instantanées, suivi des heures, exports.
            </p>

            <div className="mt-6 flex gap-3">
              <a
                href="/parents/login"
                className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-emerald-700"
              >
                Espace parent
              </a>
              <a
                href="/login"
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-indigo-700"
              >
                Espace établissement
              </a>
            </div>
          </div>

          <div className="relative">
            <div className="absolute right-0 top-0 h-full w-8 bg-yellow-400 md:w-16" />
            <div className="relative overflow-hidden rounded-l-[64px] border border-slate-200">
              <Image
                src="/accueil.png"
                alt="Parents et enseignants suivent l’assiduité"
                width={900}
                height={600}
                className="h-auto w-full object-cover"
                priority
              />
            </div>
          </div>
        </div>
      </section>

      {/* Sections (raccourcies) */}
      <section className="mx-auto max-w-5xl px-4 pb-12 pt-10 md:pt-14">
        <SectionTitle id="subscribe">S’abonner</SectionTitle>
        <div className="mt-6">
          <Accordion items={subscribeFaq} />
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 pb-24">
        <SectionTitle id="manage">Suivre son abonnement</SectionTitle>
        <div className="mt-6">
          <Accordion items={manageFaq} />
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-indigo-900 py-12 text-indigo-50">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-10 px-4 md:grid-cols-3">
          <div>
            <div className="text-2xl font-extrabold">Mon Cahier d’Absences</div>
            <div className="mt-1 text-indigo-200">
              Copyrights © {new Date().getFullYear()}
            </div>
          </div>
          <div>
            <h3 className="text-lg font-semibold">Pour commencer</h3>
            <ul className="mt-3 space-y-2 text-indigo-200">
              <li>Fonctionnalités</li>
              <li>Tableau de bord</li>
              <li>Import CSV</li>
              <li>Contact</li>
            </ul>
          </div>
          <div>
            <h3 className="text-lg font-semibold">Nous contacter</h3>
            <div className="mt-3 space-y-2 text-indigo-200">
              <div>WhatsApp : 07 20 67 20 94</div>
              <div>Appel : +225 07 13 02 37 62</div>
              <div>Email : moncahier.ci@gmail.com</div>
            </div>
          </div>
        </div>
        <div className="mx-auto mt-8 max-w-7xl px-4 text-sm text-indigo-300">
          Mentions légales · Données personnelles et cookies
        </div>
      </footer>

      {/* Bouton haut de page */}
      <a
        href="#"
        className="fixed bottom-6 right-6 grid h-12 w-12 place-items-center rounded-full bg-indigo-600 text-white shadow-lg ring-1 ring-indigo-300 hover:bg-indigo-700"
        aria-label="Revenir en haut"
      >
        ↑
      </a>
    </main>
  );
}

// src/app/page.tsx
"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./providers";
import LoginCard from "@/components/auth/LoginCard";

/* Petites icônes inline */
function ShieldIcon(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={props.className}>
      <path d="M12 3l7 3v6c0 5-3.5 8-7 9-3.5-1-7-4-7-9V6l7-3z" />
    </svg>
  );
}
function BellIcon(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={props.className}>
      <path d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14v-3a6 6 0 1 0-12 0v3c0 .53-.21 1.04-.59 1.41L4 17h5m2 3a2 2 0 0 0 2-2H9a2 2 0 0 0 2 2z" />
    </svg>
  );
}
function UsersIcon(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={props.className}>
      <path d="M16 11c1.66 0 3-1.57 3-3.5S17.66 4 16 4 13 5.57 13 7.5 14.34 11 16 11zM9 12c2 0 3.5-1.79 3.5-4S11 4 9 4 5.5 5.79 5.5 8 7 12 9 12zm7 1c-2 0-6 1-6 3v2h12v-2c0-2-4-3-6-3zM9 13c-2.67 0-8 1.34-8 4v2h8" />
    </svg>
  );
}

export default function HomePage() {
  const { session } = useAuth();
  const router = useRouter();
  const redirectedRef = useRef(false);

  // Si déjà connecté → on redirige directement vers /redirect
  useEffect(() => {
    if (session && !redirectedRef.current) {
      redirectedRef.current = true;
      router.replace("/redirect");
    }
  }, [session, router]);

  return (
    <main className="relative min-h-screen overflow-hidden">
      {/* BACKGROUND image + overlay dégradé */}
      <div className="absolute inset-0 -z-10">
        {/* Image de fond (public/accueil.png) */}
        <Image
          src="/accueil.png"
          alt="Accueil"
          fill
          priority
          className="object-cover"
        />
        {/* Overlay couleurs (bleu → indigo) */}
        <div className="absolute inset-0 bg-gradient-to-b from-sky-700/70 via-sky-800/70 to-sky-900/75" />
        {/* Légers accents rouge/jaune en haut/bas */}
        <div className="pointer-events-none absolute -top-24 left-1/2 h-64 w-[120%] -translate-x-1/2 rotate-[-6deg] bg-gradient-to-r from-yellow-400/20 via-transparent to-rose-500/20 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-32 left-1/2 h-72 w-[120%] -translate-x-1/2 rotate-[5deg] bg-gradient-to-r from-rose-500/20 via-transparent to-yellow-400/20 blur-2xl" />
      </div>

      {/* HEADER simple */}
      <header className="mx-auto flex max-w-7xl items-center justify-between px-4 py-5">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-white text-sky-700 shadow">
            <ShieldIcon className="h-5 w-5" />
          </div>
          <div className="text-white/95">
            <div className="text-sm font-semibold tracking-wide">Mon Cahier d’Absences</div>
            <div className="text-xs opacity-80">Portail Parents & Enseignants</div>
          </div>
        </div>
        <a
          href="/login"
          className="rounded-lg bg-white/20 px-3 py-1.5 text-sm font-medium text-white backdrop-blur hover:bg-white/30"
          title="Aller à la page de connexion"
        >
          Page connexion
        </a>
      </header>

      {/* HERO */}
      <section className="mx-auto grid max-w-7xl grid-cols-1 items-start gap-8 px-4 pb-16 pt-4 md:grid-cols-2 md:pb-24 md:pt-10">
        {/* Colonne texte */}
        <div className="text-white">
          <h1 className="text-3xl font-bold leading-tight md:text-5xl">
            Suivez votre enfant à l’école <span className="text-yellow-300">comme si vous y étiez</span>.
          </h1>
          <p className="mt-3 max-w-xl text-sm/6 md:text-base/7 text-white/90">
            Alerts immédiates d’<b>absence</b> ou de <b>retard</b>, tableau de bord clair,
            et échanges fluides avec l’établissement. Un écosystème pensé pour les{" "}
            <b>parents</b>, les <b>enseignants</b> et les <b>administrateurs</b>.
          </p>

          {/* Points clés */}
          <ul className="mt-6 grid gap-3 md:grid-cols-2">
            <li className="flex items-center gap-3 rounded-xl bg-white/10 px-3 py-2 backdrop-blur">
              <BellIcon className="h-5 w-5 text-yellow-300" />
              <span className="text-sm">Notifications instantanées</span>
            </li>
            <li className="flex items-center gap-3 rounded-xl bg-white/10 px-3 py-2 backdrop-blur">
              <UsersIcon className="h-5 w-5 text-rose-300" />
              <span className="text-sm">Suivi multi-enfants</span>
            </li>
            <li className="flex items-center gap-3 rounded-xl bg-white/10 px-3 py-2 backdrop-blur">
              <ShieldIcon className="h-5 w-5 text-white" />
              <span className="text-sm">Données sécurisées</span>
            </li>
            <li className="flex items-center gap-3 rounded-xl bg-white/10 px-3 py-2 backdrop-blur">
              <svg viewBox="0 0 24 24" className="h-5 w-5 text-sky-200" fill="none" stroke="currentColor" strokeWidth={1.8}>
                <path d="M4 12h16M4 6h16M4 18h10" />
              </svg>
              <span className="text-sm">Interface simple et rapide</span>
            </li>
          </ul>
        </div>

        {/* Colonne Login (la carte) */}
        <div className="md:pl-8">
          <LoginCard redirectTo="/redirect" />
          <p className="mt-3 text-center text-xs text-white/80">
            Pas encore d’accès ? Contactez l’administration de votre établissement.
          </p>
        </div>
      </section>

      {/* FOOTER court */}
      <footer className="px-4 pb-6 text-center text-xs text-white/70">
        © {new Date().getFullYear()} Mon Cahier d’Absences — Tous droits réservés
      </footer>
    </main>
  );
}

// src/app/page.tsx
"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./providers";
import {
  Bell,
  Clock,
  FileSpreadsheet,
  Rocket,
  Shield,
  Users,
  Building2,
  MessageSquare,
  PhoneCall,
  ArrowUp,
  ArrowRight,
  Quote,
} from "lucide-react";

/* ───────────────────────── Tiny UI helpers ───────────────────────── */
function SectionTitle(props: { id?: string; children: React.ReactNode }) {
  return (
    <h2
      id={props.id}
      className="scroll-mt-24 text-3xl font-extrabold tracking-tight text-slate-900 md:text-4xl"
    >
      {props.children}
    </h2>
  );
}

type FaqItem = { q: string; a: React.ReactNode };
function Accordion({ items }: { items: FaqItem[] }) {
  return (
    <div className="divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white">
      {items.map((it, i) => (
        <details key={i} className="group">
          <summary className="flex cursor-pointer list-none items-start gap-3 px-5 py-4 text-left text-base font-semibold text-slate-900 transition-colors hover:bg-slate-50">
            <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 ring-1 ring-indigo-100 transition group-open:rotate-45">
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
    "https://wa.me/2250720672094?text=Bonjour%20Mon%20Cahier%2C%20je%20souhaite%20m%E2%80%99abonner.";
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <a
        href={wa}
        target="_blank"
        rel="noreferrer"
        className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
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

/* ───────────────────────── Fancy helpers ───────────────────────── */
function TiltCard({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  function handleMove(e: React.MouseEvent) {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const rx = -(y - rect.height / 2) / (rect.height / 2);
    const ry = (x - rect.width / 2) / (rect.width / 2);
    const max = 6;
    el.style.transform = `perspective(900px) rotateX(${rx * max}deg) rotateY(${
      ry * max
    }deg) translateZ(0)`;
  }
  function handleLeave() {
    const el = ref.current;
    if (!el) return;
    el.style.transform =
      "perspective(900px) rotateX(0deg) rotateY(0deg) translateZ(0)";
  }
  return (
    <div
      ref={ref}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      className={
        "transform-gpu transition-transform duration-200 will-change-transform " +
        className
      }
    >
      {children}
    </div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
      {children}
    </span>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: any;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-50 text-indigo-700">
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          {label}
        </div>
        <div className="text-lg font-bold text-slate-900">{value}</div>
      </div>
    </div>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  desc,
}: {
  icon: any;
  title: string;
  desc: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-indigo-50 text-indigo-700">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className="text-base font-semibold text-slate-900">{title}</div>
          <p className="mt-1 text-sm leading-6 text-slate-700">{desc}</p>
        </div>
      </div>
    </div>
  );
}

/* Boutons d’espaces de connexion : version plus pro / soft */
function ConnectionCard({
  icon: Icon,
  title,
  badge,
  description,
  href,
}: {
  icon: any;
  title: string;
  badge?: string;
  description: string;
  href: string;
}) {
  return (
    <a
      href={href}
      className="group flex h-full flex-col justify-between rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-sm transition hover:border-indigo-400 hover:shadow-md"
    >
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-50 text-indigo-700">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className="text-sm font-semibold text-slate-900">{title}</div>
          {badge && (
            <div className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-emerald-600">
              {badge}
            </div>
          )}
        </div>
      </div>
      <p className="mt-3 flex-1 text-xs leading-5 text-slate-600">
        {description}
      </p>
      <div className="mt-4 inline-flex items-center text-sm font-semibold text-indigo-600 group-hover:text-indigo-700">
        <span>Se connecter</span>
        <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
      </div>
    </a>
  );
}

/* Marquee Banner */
function MarqueeBanner({ text }: { text: string }) {
  return (
    <div className="relative z-10 w-full overflow-hidden bg-slate-900 text-slate-100">
      <div
        className="flex w-max items-center gap-10 py-3 pl-6 pr-10 text-sm [animation:marquee_28s_linear_infinite] hover:[animation-play-state:paused]"
        role="status"
        aria-live="polite"
        aria-label={text}
      >
        {Array.from({ length: 8 }).map((_, i) => (
          <span key={i} className="font-medium tracking-wide">
            {text} <span aria-hidden>•</span>
          </span>
        ))}
      </div>
      <style jsx>{`
        @keyframes marquee {
          0% {
            transform: translateX(0);
          }
          100% {
            transform: translateX(-50%);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          div[role="status"] {
            animation: none !important;
            transform: none !important;
          }
        }
      `}</style>
    </div>
  );
}

/* ───────────────────────── Page ───────────────────────── */
export default function HomePage() {
  const { session } = useAuth();
  const router = useRouter();
  const redirectedRef = useRef(false);

  // Si déjà connecté (admin/enseignant/parent), on bascule directement dans l’app
  useEffect(() => {
    if (session && !redirectedRef.current) {
      redirectedRef.current = true;
      router.replace("/redirect");
    }
  }, [session, router]);

  const subscribeFaq: FaqItem[] = [
    {
      q: "Comment s’abonner à Mon Cahier ?",
      a: (
        <>
          L’abonnement se fait directement avec notre équipe. Les établissements
          restent <b>autonomes</b> ensuite pour créer classes, enseignants,
          matières et lier les parents.
          <ContactCTA />
        </>
      ),
    },
    {
      q: "Quelles fonctionnalités sont incluses dès l’abonnement ?",
      a: (
        <ul className="ml-5 list-disc space-y-1">
          <li>
            Création autonome des <b>classes</b> et des{" "}
            <b>comptes enseignants</b>.
          </li>
          <li>
            Contacts parents reliés aux élèves,{" "}
            <b>notifications temps réel</b> (absence/retard).
          </li>
          <li>
            <b>Suivi des heures effectuées</b> par enseignant sur une période
            donnée.
          </li>
          <li>
            <b>Cahier de notes complet</b> : devoirs, interrogations, moyennes
            et bulletins.
          </li>
          <li>
            <b>Tableaux de bord</b> clairs ; exports CSV (absences & notes).
          </li>
          <li>
            Import facile (CSV) des <b>classes</b>, <b>enseignants</b> et élèves.
          </li>
          <li>
            Affectations <b>en masse</b> : créer et associer des{" "}
            <b>disciplines</b> aux enseignants en un coup.
          </li>
          <li>
            Rôles clairs : super admin, admin d’établissement, enseignant,
            parent — <b>une seule vue par rôle</b>.
          </li>
          <li>
            <b>Modèle de prédiction</b> du taux de réussite par classe, basé sur
            absences, notes et matières clés.
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
          Dans <b>Paramètres → Abonnement</b>, vous voyez l’échéance et
          l’historique des paiements.
        </>
      ),
    },
    {
      q: "Comment sont envoyées les notifications aux parents ?",
      a: (
        <>
          Lors de la validation de l’appel ou d’une nouvelle note publiée, le
          parent est notifié <b>immédiatement</b>.
        </>
      ),
    },
  ];

  const MARQUEE_TEXT =
    "Mon Cahier : absences, notes et prédiction du taux de réussite dans un seul outil.";

  return (
    <main className="relative min-h-screen bg-slate-50">
      {/* Background soft (légères tâches de couleur) */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
      >
        <div className="absolute left-[5%] top-[-10%] h-56 w-56 rounded-full bg-indigo-200/25 blur-3xl md:h-72 md:w-72" />
        <div className="absolute right-[-5%] top-[30%] h-64 w-64 rounded-full bg-emerald-200/30 blur-3xl md:h-80 md:w-80" />
        <div className="absolute bottom-[-15%] left-[15%] h-60 w-60 rounded-full bg-sky-200/25 blur-3xl md:h-72 md:w-72" />
      </div>

      {/* Header : plus sobre / pro */}
      <header className="sticky top-0 z-30 w-full border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <a href="#hero" className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100">
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
                Mon Cahier
              </div>
              <div className="text-xs text-slate-500">
                Absences, notes &amp; prédiction des résultats
              </div>
            </div>
          </a>

          <nav className="hidden items-center gap-6 text-sm font-semibold text-slate-700 md:flex">
            <a href="#features" className="hover:text-indigo-700">
              Fonctionnalités
            </a>
            <a href="#steps" className="hover:text-indigo-700">
              Comment ça marche
            </a>
            <a href="#testimonials" className="hover:text-indigo-700">
              Témoignages
            </a>
            <a href="#faq" className="hover:text-indigo-700">
              FAQ
            </a>
            <a href="#contact" className="hover:text-indigo-700">
              Contact
            </a>
          </nav>

          {/* Connexions Header (desktop) : plus minimalistes */}
          <div className="hidden items-center gap-3 md:flex">
            <a
              href="/parents/login"
              className="inline-flex items-center gap-2 rounded-full border border-emerald-500 bg-white px-4 py-1.5 text-xs font-semibold text-emerald-700 shadow-sm hover:bg-emerald-50"
            >
              <Users className="h-4 w-4" />
              <span>Espace parent</span>
            </a>
            <a
              href="/login?space=direction"
              className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:border-indigo-400 hover:text-indigo-700"
            >
              <Building2 className="h-4 w-4" />
              <span>Espace direction</span>
            </a>
            <a
              href="/login?space=enseignant"
              className="inline-flex items-center gap-2 rounded-full bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700"
            >
              <FileSpreadsheet className="h-4 w-4" />
              <span>Espace enseignant</span>
            </a>
          </div>

          {/* Mobile : bouton unique qui scrolle vers le bloc de choix d’espace */}
          <a
            href="#spaces"
            className="inline-flex items-center gap-2 rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 md:hidden"
          >
            <span>Se connecter</span>
          </a>
        </div>
      </header>

      {/* Bande défilante */}
      <MarqueeBanner text={MARQUEE_TEXT} />

      {/* HERO */}
      <section id="hero" className="relative overflow-hidden">
        <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-10 px-4 py-10 md:grid-cols-2 md:py-16">
          {/* Colonne texte + cartes de connexion plus pro */}
          <div className="relative z-10">
            <Pill>
              <Rocket className="h-3.5 w-3.5" />
              <span>Solution complète pour les établissements scolaires</span>
            </Pill>
            <h1 className="mt-4 text-[2.25rem] font-extrabold leading-tight text-slate-900 sm:text-[2.6rem] md:text-[3.1rem]">
              Le cahier d’absences &amp; de notes{" "}
              <span className="bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 bg-clip-text text-transparent">
                intelligent
              </span>
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-7 text-slate-700 sm:text-base">
              Appel ultra-rapide, cahier de notes complet, bulletins
              automatiques, alertes parents instantanées et{" "}
              <b>modèle de prédiction du taux de réussite</b> de chaque classe.
            </p>

            {/* Bloc de choix d’espace (soft, très professionnel) */}
            <div
              id="spaces"
              className="mt-6 w-full max-w-xl rounded-3xl border border-slate-200 bg-white/95 p-5 shadow-md"
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                ESPACES DE CONNEXION
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Chaque profil dispose de sa propre interface, sans mélange des
                rôles.
              </p>

              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <ConnectionCard
                  icon={Users}
                  title="Espace parent"
                  badge="Accès mobile"
                  href="/parents/login"
                  description="Suivi des absences, retards, notes et bulletins de vos enfants, depuis le smartphone."
                />
                <ConnectionCard
                  icon={Building2}
                  title="Espace direction"
                  href="/login?space=direction"
                  description="Vue globale des classes, enseignants, statistiques et prédiction du taux de réussite."
                />
                <ConnectionCard
                  icon={FileSpreadsheet}
                  title="Espace enseignant"
                  href="/login?space=enseignant"
                  description="Appel, saisie des notes, moyennes et bulletins en quelques clics, en classe ou à la maison."
                />
              </div>
            </div>

            {/* Stats */}
            <div className="mt-7 grid max-w-2xl grid-cols-2 gap-3 sm:gap-4">
              <Stat icon={Users} label="Parents touchés" value="&gt; 10 000" />
              <Stat icon={Clock} label="Temps d’appel moyen" value="&lt; 60 s" />
              <Stat
                icon={Bell}
                label="Notifications envoyées"
                value="&gt; 250 000"
              />
              <Stat
                icon={Rocket}
                label="Prédiction du taux de réussite"
                value="Modèle intelligent"
              />
            </div>
          </div>

          {/* Colonne illustration */}
          <div className="relative">
            <TiltCard className="relative overflow-hidden rounded-[32px] border border-slate-200 bg-white/80 shadow-xl">
              <Image
                src="/accueil.png"
                alt="Interface Mon Cahier : absences, notes et prédiction"
                width={900}
                height={600}
                className="h-auto w-full object-cover"
                priority
              />
            </TiltCard>
          </div>
        </div>
      </section>

      {/* Steps / How it works */}
      <section id="steps" className="mx-auto max-w-7xl px-4 pb-10 md:pb-12">
        <SectionTitle>Comment ça marche</SectionTitle>
        <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-indigo-700">
              <Building2 className="h-4 w-4" /> Établissement
            </div>
            <ol className="grid gap-3 text-sm text-slate-700">
              <li className="flex items-start gap-3">
                <span className="mt-1 inline-grid h-6 w-6 flex-none place-items-center rounded-full bg-indigo-600 text-white">
                  1
                </span>
                Créez vos classes, matières et comptes enseignants (import CSV
                possible).
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1 inline-grid h-6 w-6 flex-none place-items-center rounded-full bg-indigo-600 text-white">
                  2
                </span>
                Affectez vos disciplines aux professeurs en un clic (absences et
                cahier de notes).
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1 inline-grid h-6 w-6 flex-none place-items-center rounded-full bg-indigo-600 text-white">
                  3
                </span>
                En classe, lancez l’appel et saisissez les notes : absences,
                retards et évaluations alimentent les tableaux de bord et le{" "}
                <b>modèle de prédiction</b> du taux de réussite.
              </li>
            </ol>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-emerald-700">
              <Users className="h-4 w-4" /> Parent
            </div>
            <ol className="grid gap-3 text-sm text-slate-700">
              <li className="flex items-start gap-3">
                <span className="mt-1 inline-grid h-6 w-6 flex-none place-items-center rounded-full bg-emerald-600 text-white">
                  1
                </span>
                Connectez-vous à l’Espace parent.
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1 inline-grid h-6 w-6 flex-none place-items-center rounded-full bg-emerald-600 text-white">
                  2
                </span>
                Associez votre enfant via son matricule (si requis par
                l’établissement).
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1 inline-grid h-6 w-6 flex-none place-items-center rounded-full bg-emerald-600 text-white">
                  3
                </span>
                Recevez les alertes d’absence/retard et consultez{" "}
                <b>notes, moyennes et bulletins</b> depuis votre téléphone.
              </li>
            </ol>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-7xl px-4 pb-10 md:pb-16">
        <SectionTitle>Fonctionnalités clés</SectionTitle>
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          <FeatureCard
            icon={Clock}
            title="Appel ultra-rapide"
            desc="Démarrez un créneau en 1 clic et notez absences/retards en quelques secondes, depuis le téléphone de la classe."
          />
          <FeatureCard
            icon={Bell}
            title="Notifications instantanées"
            desc="Les parents sont alertés en temps réel après validation de l’appel ou publication d’une note."
          />
          <FeatureCard
            icon={FileSpreadsheet}
            title="Cahier de notes & bulletins"
            desc="Saisissez devoirs, interrogations et examens ; Mon Cahier calcule automatiquement moyennes, bulletins et exports."
          />
          <FeatureCard
            icon={Rocket}
            title="Prédiction du taux de réussite"
            desc="Un modèle interne analyse absences, notes et matières clés pour estimer le taux de réussite de chaque classe."
          />
          <FeatureCard
            icon={Shield}
            title="Rôles & sécurité"
            desc="Accès sécurisés, RLS et vues dédiées : super admin, admin, enseignant, parent ; aucune confusion de rôle."
          />
          <FeatureCard
            icon={Users}
            title="Parents connectés"
            desc="Associez les responsables aux élèves et centralisez la communication autour de l’assiduité et des résultats."
          />
        </div>
      </section>

      {/* Témoignages / Ils nous font confiance */}
      <section
        id="testimonials"
        className="mx-auto max-w-7xl px-4 pb-10 md:pb-16"
      >
        <SectionTitle>Ils nous font confiance</SectionTitle>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">
          Chefs d’établissement, enseignants et parents utilisent déjà Mon
          Cahier au quotidien.
        </p>

        {/* Cartes témoignages */}
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <article className="flex h-full flex-col rounded-2xl bg-white p-5 shadow-sm ring-1 ring-emerald-100">
            <div className="mb-3 inline-flex h-8 w-8 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
              <Quote className="h-4 w-4" />
            </div>
            <p className="text-sm text-slate-700">
              « Les retards et absences sont enfin suivis sérieusement, sans
              piles de papiers. »
            </p>
            <p className="mt-4 text-xs font-semibold text-emerald-800">
              Proviseur, Lycée public Abidjan
            </p>
          </article>

          <article className="flex h-full flex-col rounded-2xl bg-white p-5 shadow-sm ring-1 ring-indigo-100">
            <div className="mb-3 inline-flex h-8 w-8 items-center justify-center rounded-full bg-indigo-50 text-indigo-700">
              <Quote className="h-4 w-4" />
            </div>
            <p className="text-sm text-slate-700">
              « Les parents nous disent qu’ils se sentent vraiment informés du
              travail de leurs enfants. »
            </p>
            <p className="mt-4 text-xs font-semibold text-indigo-800">
              Directeur des études, Collège privé à Yopougon
            </p>
          </article>

          <article className="flex h-full flex-col rounded-2xl bg-white p-5 shadow-sm ring-1 ring-violet-100">
            <div className="mb-3 inline-flex h-8 w-8 items-center justify-center rounded-full bg-violet-50 text-violet-700">
              <Quote className="h-4 w-4" />
            </div>
            <p className="text-sm text-slate-700">
              « Ce qui est intéressant, c’est qu’on sait si un enseignant est en
              classe ou pas. »
            </p>
            <p className="mt-4 text-xs font-semibold text-violet-800">
              Responsable pédagogique, Établissement partenaire
            </p>
          </article>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="mx-auto max-w-7xl px-4 pb-10 md:pb-16">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          <div>
            <SectionTitle>S’abonner</SectionTitle>
            <div className="mt-6">
              <Accordion items={subscribeFaq} />
            </div>
          </div>
          <div>
            <SectionTitle>Gérer son abonnement</SectionTitle>
            <div className="mt-6">
              <Accordion items={manageFaq} />
            </div>
          </div>
        </div>
      </section>

      {/* Big Contact CTA */}
      <section id="contact" className="mx-auto max-w-7xl px-4 pb-20">
        <div className="relative overflow-hidden rounded-3xl border border-indigo-200 bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 p-0.5 shadow-xl">
          <div className="rounded-[calc(1.5rem-2px)] bg-white/98 p-6 backdrop-blur md:p-10">
            <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
              <div>
                <h3 className="text-2xl font-extrabold text-slate-900 md:text-3xl">
                  Parlons de votre établissement
                </h3>
                <p className="mt-1 max-w-2xl text-sm text-slate-700">
                  On s’occupe de la mise en route. Vous gardez la main ensuite :
                  classes, enseignants, matières, cahier de notes, prédiction du
                  taux de réussite… le tout en autonomie.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <a
                  href="https://wa.me/2250720672094?text=Bonjour%20Mon%20Cahier%2C%20je%20souhaite%20m%E2%80%99abonner."
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-emerald-700"
                >
                  <MessageSquare className="h-4 w-4" /> WhatsApp
                </a>
                <a
                  href="tel:+2250713023762"
                  className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-800 ring-1 ring-slate-200 hover:bg-slate-50"
                >
                  <PhoneCall className="h-4 w-4" /> Appeler
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-900 py-12 text-slate-100">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-10 px-4 md:grid-cols-3">
          <div>
            <div className="text-2xl font-extrabold">Mon Cahier</div>
            <div className="mt-1 text-slate-400">
              Copyrights © {new Date().getFullYear()}
            </div>
            <div className="mt-1 text-[11px] font-semibold text-slate-300">
              Conçu et développé par{" "}
              <span className="text-slate-100">NEXA DIGITAL SARL</span>
            </div>
          </div>
          <div>
            <h3 className="text-lg font-semibold">Pour commencer</h3>
            <ul className="mt-3 space-y-2 text-sm text-slate-300">
              <li>
                <a href="#features" className="hover:text-white">
                  Fonctionnalités
                </a>
              </li>
              <li>
                <a href="#steps" className="hover:text-white">
                  Comment ça marche
                </a>
              </li>
              <li>
                <a href="#faq" className="hover:text-white">
                  FAQ
                </a>
              </li>
              <li>
                <a href="#contact" className="hover:text-white">
                  Contact
                </a>
              </li>
            </ul>
          </div>
          <div>
            <h3 className="text-lg font-semibold">Nous contacter</h3>
            <div className="mt-3 space-y-2 text-sm text-slate-300">
              <div>WhatsApp : 07 20 67 20 94</div>
              <div>Appel : +225 07 13 02 37 62</div>
              <div>Email : moncahier.ci@gmail.com</div>
            </div>
          </div>
        </div>
        <div className="mx-auto mt-8 max-w-7xl px-4 text-xs text-slate-400">
          Mentions légales · Données personnelles et cookies
        </div>
      </footer>

      {/* Bouton haut de page */}
      <a
        href="#"
        className="fixed bottom-6 right-6 grid h-12 w-12 place-items-center rounded-full bg-indigo-600 text-white shadow-lg ring-1 ring-indigo-300 transition hover:bg-indigo-700"
        aria-label="Revenir en haut"
      >
        <ArrowUp className="h-5 w-5" />
      </a>
    </main>
  );
}

// src/app/page.tsx
"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./providers";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  ArrowUp,
  Bell,
  Clock,
  BookOpenCheck,
  Building2,
  Shield,
  ChartColumnBig,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileSpreadsheet,
  MessageSquare,
  PhoneCall,
  Quote,
  Rocket,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";

/* -------------------------------------------------------------------------- */
/*                                  DonnÃ©es                                   */
/* -------------------------------------------------------------------------- */

type FaqItem = {
  q: string;
  a: React.ReactNode;
};

const marqueeItems = [
  "Absences",
  "Retards",
  "Notes",
  "Bulletins",
  "Notifications parents",
  "PrÃ©diction du taux de rÃ©ussite",
  "Suivi pÃ©dagogique",
  "Pilotage Ã©tablissement",
];

const stats = [
  {
    icon: Users,
    label: "Parents informÃ©s",
    value: "+10 000",
    hint: "via mobile et notifications",
  },
  {
    icon: Clock3,
    label: "Appel en classe",
    value: "< 60 s",
    hint: "sur smartphone ou ordinateur",
  },
  {
    icon: Bell,
    label: "Alertes envoyÃ©es",
    value: "+250 000",
    hint: "absences, retards et notes",
  },
  {
    icon: ChartColumnBig,
    label: "Pilotage",
    value: "Intelligent",
    hint: "tableaux de bord & prÃ©diction",
  },
];

const features = [
  {
    icon: Clock3,
    title: "Appel ultra-rapide",
    desc: "En quelques secondes, lâ€™enseignant marque les absences et les retards depuis son tÃ©lÃ©phone ou son ordinateur.",
  },
  {
    icon: Bell,
    title: "Notifications immÃ©diates",
    desc: "Les parents sont informÃ©s rapidement aprÃ¨s validation de lâ€™appel ou publication dâ€™une nouvelle note.",
  },
  {
    icon: FileSpreadsheet,
    title: "Cahier de notes complet",
    desc: "Devoirs, interrogations, examens, moyennes, bulletins et exports : tout est centralisÃ© dans une seule plateforme.",
  },
  {
    icon: ChartColumnBig,
    title: "PrÃ©diction du taux de rÃ©ussite",
    desc: "Le systÃ¨me croise absences, notes et matiÃ¨res clÃ©s pour aider la direction Ã  anticiper les rÃ©sultats dâ€™une classe.",
  },
  {
    icon: ShieldCheck,
    title: "RÃ´les clairs et sÃ©curisÃ©s",
    desc: "Chaque acteur possÃ¨de son espace dÃ©diÃ© : super admin, direction, enseignant, parent. Aucune confusion dâ€™interface.",
  },
  {
    icon: BookOpenCheck,
    title: "Suivi pÃ©dagogique rÃ©el",
    desc: "Lâ€™administration garde une vision concrÃ¨te des cours saisis, des Ã©valuations et de lâ€™activitÃ© pÃ©dagogique.",
  },
];

const directionBenefits = [
  "CrÃ©ation des classes, matiÃ¨res et comptes enseignants",
  "Import CSV des Ã©lÃ¨ves, classes et enseignants",
  "Affectations en masse des disciplines",
  "Suivi des heures et de lâ€™activitÃ© pÃ©dagogique",
  "Tableaux de bord lisibles pour dÃ©cider vite",
  "Vision globale sur absences, notes et tendances",
];

const parentBenefits = [
  "Consultation des absences et retards",
  "AccÃ¨s aux notes et aux moyennes",
  "Lecture des bulletins depuis le tÃ©lÃ©phone",
  "Vision plus claire du suivi scolaire de lâ€™enfant",
];

const testimonials = [
  {
    quote:
      "Les retards et absences sont enfin suivis sÃ©rieusement, sans piles de papiers.",
    author: "Proviseur, lycÃ©e public Ã  Abidjan",
    tone:
      "ring-emerald-100 bg-gradient-to-br from-white to-emerald-50/60 text-emerald-800",
    iconTone: "bg-emerald-100 text-emerald-700",
  },
  {
    quote:
      "Les parents nous disent quâ€™ils se sentent beaucoup plus informÃ©s du travail de leurs enfants.",
    author: "Directeur des Ã©tudes, collÃ¨ge privÃ© Ã  Yopougon",
    tone:
      "ring-indigo-100 bg-gradient-to-br from-white to-indigo-50/60 text-indigo-800",
    iconTone: "bg-indigo-100 text-indigo-700",
  },
  {
    quote:
      "Ce qui change vraiment, câ€™est la visibilitÃ© sur les cours, les notes et le rythme de lâ€™Ã©tablissement.",
    author: "Responsable pÃ©dagogique, Ã©tablissement partenaire",
    tone:
      "ring-violet-100 bg-gradient-to-br from-white to-violet-50/60 text-violet-800",
    iconTone: "bg-violet-100 text-violet-700",
  },
];

const subscribeFaq: FaqItem[] = [
  {
    q: "Comment sâ€™abonner Ã  Mon Cahier ?",
    a: (
      <>
        Lâ€™abonnement se fait directement avec notre Ã©quipe. Une fois la mise en
        route faite, lâ€™Ã©tablissement reste autonome pour gÃ©rer ses classes,
        enseignants, matiÃ¨res et contacts parents.
        <ContactCTA />
      </>
    ),
  },
  {
    q: "Quelles fonctionnalitÃ©s sont incluses dÃ¨s lâ€™abonnement ?",
    a: (
      <ul className="ml-5 list-disc space-y-2">
        <li>CrÃ©ation autonome des classes et des comptes enseignants.</li>
        <li>Contacts parents reliÃ©s aux Ã©lÃ¨ves.</li>
        <li>Notifications dâ€™absence, de retard et de notes.</li>
        <li>Cahier de notes complet avec moyennes et bulletins.</li>
        <li>Tableaux de bord clairs pour lâ€™administration.</li>
        <li>Imports CSV et affectations en masse.</li>
        <li>RÃ´les dÃ©diÃ©s : direction, enseignant, parent.</li>
        <li>PrÃ©diction du taux de rÃ©ussite par classe.</li>
      </ul>
    ),
  },
];

const manageFaq: FaqItem[] = [
  {
    q: "Comment suivre lâ€™Ã©chÃ©ance de lâ€™abonnement ?",
    a: (
      <>
        Dans <b>ParamÃ¨tres â†’ Abonnement</b>, lâ€™Ã©tablissement peut consulter la
        situation de son abonnement et son historique de paiements.
      </>
    ),
  },
  {
    q: "Comment les parents reÃ§oivent-ils les informations ?",
    a: (
      <>
        DÃ¨s que lâ€™appel est validÃ© ou quâ€™une note est publiÃ©e, les parents
        peuvent Ãªtre informÃ©s rapidement selon la configuration active de
        lâ€™Ã©tablissement.
      </>
    ),
  },
];

/* -------------------------------------------------------------------------- */
/*                               UI composants                                */
/* -------------------------------------------------------------------------- */

function Container({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 ${className}`}>
      {children}
    </div>
  );
}

function SectionTitle({
  eyebrow,
  title,
  subtitle,
  center = false,
  id,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  center?: boolean;
  id?: string;
}) {
  return (
    <div
      id={id}
      className={center ? "mx-auto max-w-3xl text-center" : "max-w-3xl"}
    >
      {eyebrow ? (
        <div className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-indigo-700">
          <Sparkles className="h-3.5 w-3.5" />
          {eyebrow}
        </div>
      ) : null}

      <h2 className="mt-4 text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">
        {title}
      </h2>

      {subtitle ? (
        <p className="mt-3 text-sm leading-7 text-slate-600 sm:text-base">
          {subtitle}
        </p>
      ) : null}
    </div>
  );
}

function GlassBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-white/60 bg-white/80 px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm backdrop-blur">
      {children}
    </span>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="group rounded-3xl border border-slate-200/80 bg-white/90 p-4 shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-lg">
      <div className="flex items-start gap-3">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-md">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">
            {label}
          </div>
          <div className="mt-1 text-xl font-black text-slate-900">{value}</div>
          <div className="mt-1 text-xs text-slate-500">{hint}</div>
        </div>
      </div>
    </div>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  desc,
}: {
  icon: LucideIcon;
  title: string;
  desc: string;
}) {
  return (
    <div className="group relative overflow-hidden rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-xl">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500" />
      <div className="flex items-start gap-4">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100 transition group-hover:bg-indigo-600 group-hover:text-white">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-base font-extrabold text-slate-900">{title}</h3>
          <p className="mt-2 text-sm leading-7 text-slate-600">{desc}</p>
        </div>
      </div>
    </div>
  );
}

function MiniBenefitList({ items }: { items: string[] }) {
  return (
    <ul className="grid gap-3">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-3 text-sm text-slate-700">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function ConnectionCard({
  icon: Icon,
  title,
  description,
  href,
  accent,
  badge,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  href: string;
  accent: string;
  badge?: string;
}) {
  return (
    <a
      href={href}
      className="group relative flex h-full flex-col justify-between overflow-hidden rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition duration-300 hover:-translate-y-1 hover:border-slate-300 hover:shadow-xl"
    >
      <div
        className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${accent}`}
      />
      <div>
        <div className="flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-50 text-slate-700 ring-1 ring-slate-200 transition group-hover:bg-slate-900 group-hover:text-white">
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <div className="text-base font-extrabold text-slate-900">{title}</div>
            {badge ? (
              <div className="mt-1 text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-600">
                {badge}
              </div>
            ) : null}
          </div>
        </div>

        <p className="mt-4 text-sm leading-7 text-slate-600">{description}</p>
      </div>

      <div className="mt-6 inline-flex items-center gap-2 text-sm font-bold text-indigo-700">
        AccÃ©der Ã  cet espace
        <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
      </div>
    </a>
  );
}

function StepCard({
  number,
  title,
  desc,
  tone = "indigo",
}: {
  number: string;
  title: string;
  desc: string;
  tone?: "indigo" | "emerald";
}) {
  const toneClasses =
    tone === "emerald"
      ? "bg-emerald-600 shadow-emerald-200"
      : "bg-indigo-600 shadow-indigo-200";

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-4">
        <div
          className={`grid h-10 w-10 shrink-0 place-items-center rounded-2xl text-sm font-black text-white shadow-md ${toneClasses}`}
        >
          {number}
        </div>
        <div>
          <div className="text-base font-extrabold text-slate-900">{title}</div>
          <p className="mt-2 text-sm leading-7 text-slate-600">{desc}</p>
        </div>
      </div>
    </div>
  );
}

function Accordion({ items }: { items: FaqItem[] }) {
  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      {items.map((it, i) => (
        <details
          key={i}
          className="group border-b border-slate-200 last:border-b-0"
        >
          <summary className="flex cursor-pointer list-none items-start gap-3 px-5 py-5 text-left">
            <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100 transition group-open:rotate-45">
              +
            </span>
            <span className="pr-2 text-sm font-extrabold text-slate-900 sm:text-base">
              {it.q}
            </span>
          </summary>
          <div className="px-14 pb-5 pt-0 text-sm leading-7 text-slate-600">
            {it.a}
          </div>
        </details>
      ))}
    </div>
  );
}

function ContactCTA() {
  const wa =
    "https://wa.me/2250720672094?text=Bonjour%20Mon%20Cahier%2C%20je%20souhaite%20m%E2%80%99abonner.";

  return (
    <div className="mt-5 flex flex-wrap items-center gap-3">
      <a
        href={wa}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700"
      >
        <MessageSquare className="h-4 w-4" />
        DÃ©marrer sur WhatsApp
      </a>

      <a
        href="tel:+2250713023762"
        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-100 px-4 py-2 text-sm font-bold text-slate-800 transition hover:bg-white"
      >
        <PhoneCall className="h-4 w-4" />
        Appeler le commercial
      </a>

      <a
        href="mailto:moncahier.ci@gmail.com"
        className="text-sm font-bold text-indigo-700 hover:underline"
      >
        moncahier.ci@gmail.com
      </a>
    </div>
  );
}

function Marquee() {
  const content = useMemo(() => [...marqueeItems, ...marqueeItems], []);

  return (
    <div className="relative overflow-hidden border-y border-slate-200 bg-white/90 backdrop-blur">
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-slate-50 to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-slate-50 to-transparent" />
      <div className="flex w-max animate-[marquee_28s_linear_infinite] items-center gap-4 py-3">
        {content.map((item, idx) => (
          <div
            key={`${item}-${idx}`}
            className="inline-flex items-center gap-4 whitespace-nowrap text-sm font-semibold text-slate-700"
          >
            <span>{item}</span>
            <span className="text-slate-300">â€¢</span>
          </div>
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
          div[class*="animate-[marquee"] {
            animation: none !important;
            transform: none !important;
          }
        }
      `}</style>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                   Page                                     */
/* -------------------------------------------------------------------------- */

export default function HomePage() {
  const { session } = useAuth();
  const router = useRouter();
  const redirectedRef = useRef(false);

  useEffect(() => {
    if (session && !redirectedRef.current) {
      redirectedRef.current = true;
      router.replace("/redirect");
    }
  }, [session, router]);

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-slate-50 text-slate-900">
      {/* Fonds dÃ©coratifs */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
      >
        <div className="absolute left-[-8%] top-[-6%] h-72 w-72 rounded-full bg-indigo-300/25 blur-3xl sm:h-96 sm:w-96" />
        <div className="absolute right-[-8%] top-[10%] h-80 w-80 rounded-full bg-violet-300/20 blur-3xl sm:h-[28rem] sm:w-[28rem]" />
        <div className="absolute bottom-[-12%] left-[15%] h-72 w-72 rounded-full bg-emerald-300/20 blur-3xl sm:h-96 sm:w-96" />
      </div>

      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/80 backdrop-blur-xl">
        <Container className="flex items-center justify-between py-3">
          <a href="#hero" className="group flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-200">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-black tracking-wide text-slate-900">
                Mon Cahier
              </div>
              <div className="text-xs text-slate-500">
                Absences, notes &amp; pilotage intelligent
              </div>
            </div>
          </a>

          <nav className="hidden items-center gap-6 text-sm font-bold text-slate-700 lg:flex">
            <a href="#hero" className="transition hover:text-indigo-700">
              Accueil
            </a>
            <a href="#features" className="transition hover:text-indigo-700">
              FonctionnalitÃ©s
            </a>
            <a href="#steps" className="transition hover:text-indigo-700">
              Comment Ã§a marche
            </a>
            <a
              href="#testimonials"
              className="transition hover:text-indigo-700"
            >
              TÃ©moignages
            </a>
            <a href="#faq" className="transition hover:text-indigo-700">
              FAQ
            </a>
            <a href="#contact" className="transition hover:text-indigo-700">
              Contact
            </a>
          </nav>

          <div className="hidden items-center gap-3 md:flex">
            <a
              href="/parents/login"
              className="inline-flex items-center gap-2 rounded-full border border-emerald-300 bg-emerald-50 px-4 py-2 text-xs font-extrabold text-emerald-700 transition hover:bg-emerald-100"
            >
              <Users className="h-4 w-4" />
              Espace parent
            </a>
            <a
              href="/login?space=direction"
              className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-extrabold text-slate-700 transition hover:border-indigo-300 hover:text-indigo-700"
            >
              <Building2 className="h-4 w-4" />
              Espace direction
            </a>
            <a
              href="/login?space=enseignant"
              className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-xs font-extrabold text-white shadow-sm transition hover:bg-slate-800"
            >
              <FileSpreadsheet className="h-4 w-4" />
              Espace enseignant
            </a>
          </div>

          <a
            href="#spaces"
            className="inline-flex items-center gap-2 rounded-full bg-indigo-600 px-4 py-2 text-sm font-extrabold text-white shadow-sm transition hover:bg-indigo-700 md:hidden"
          >
            Se connecter
          </a>
        </Container>
      </header>

      <Marquee />

      {/* Hero */}
      <section id="hero" className="relative pt-8 sm:pt-10">
        <Container>
          <div className="grid items-center gap-10 lg:grid-cols-[1.08fr_0.92fr]">
            <div className="relative z-10">
              <GlassBadge>
                <Rocket className="h-3.5 w-3.5 text-indigo-600" />
                Solution professionnelle pour Ã©tablissements scolaires
              </GlassBadge>

              <h1 className="mt-5 max-w-4xl text-4xl font-black leading-[1.05] tracking-tight text-slate-900 sm:text-5xl lg:text-6xl">
                Le cahier scolaire{" "}
                <span className="bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 bg-clip-text text-transparent">
                  nouvelle gÃ©nÃ©ration
                </span>
              </h1>

              <p className="mt-5 max-w-2xl text-sm leading-7 text-slate-600 sm:text-base">
                GÃ©rez les absences, les retards, les notes, les bulletins et la
                relation avec les parents dans une interface Ã©lÃ©gante,
                institutionnelle et pensÃ©e pour le terrain.
              </p>

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <a
                  href="https://wa.me/2250720672094?text=Bonjour%20Mon%20Cahier%2C%20je%20souhaite%20m%E2%80%99abonner."
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-extrabold text-white shadow-lg shadow-slate-200 transition hover:bg-slate-800"
                >
                  Demander une mise en route
                  <ArrowRight className="h-4 w-4" />
                </a>

                <a
                  href="#spaces"
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-extrabold text-slate-800 shadow-sm transition hover:border-indigo-300 hover:text-indigo-700"
                >
                  Choisir mon espace
                  <ChevronRight className="h-4 w-4" />
                </a>
              </div>

              {/* Bloc espaces de connexion */}
              <div
                id="spaces"
                className="mt-8 rounded-[2rem] border border-slate-200 bg-white/95 p-5 shadow-xl shadow-slate-200/60 backdrop-blur sm:p-6"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">
                      Espaces de connexion
                    </div>
                    <h2 className="mt-1 text-xl font-black text-slate-900">
                      Une interface dÃ©diÃ©e pour chaque profil
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Direction, enseignant, parent : chaque rÃ´le a son propre
                      univers.
                    </p>
                  </div>

                  <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-700 ring-1 ring-emerald-200">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    ZÃ©ro ambiguÃ¯tÃ© de rÃ´le
                  </div>
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-3">
                  <ConnectionCard
                    icon={Users}
                    title="Espace parent"
                    badge="AccÃ¨s mobile"
                    href="/parents/login"
                    accent="from-emerald-500 to-teal-500"
                    description="Consultez absences, retards, notes, moyennes et bulletins de vos enfants directement depuis votre tÃ©lÃ©phone."
                  />
                  <ConnectionCard
                    icon={Building2}
                    title="Espace direction"
                    href="/login?space=direction"
                    accent="from-indigo-500 to-violet-500"
                    description="Pilotez les classes, les enseignants, les statistiques, les alertes et la prÃ©diction du taux de rÃ©ussite."
                  />
                  <ConnectionCard
                    icon={FileSpreadsheet}
                    title="Espace enseignant"
                    href="/login?space=enseignant"
                    accent="from-slate-700 to-slate-900"
                    description="Faites lâ€™appel, saisissez les notes et alimentez les bulletins en quelques clics, en classe ou Ã  distance."
                  />
                </div>
              </div>

              {/* Stats */}
              <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {stats.map((item) => (
                  <StatCard key={item.label} {...item} />
                ))}
              </div>
            </div>

            {/* Mockup / visuel */}
            <div className="relative">
              <div className="absolute -inset-5 rounded-[2.5rem] bg-gradient-to-r from-indigo-500/15 via-violet-500/15 to-fuchsia-500/15 blur-2xl" />
              <div className="relative overflow-hidden rounded-[2.2rem] border border-white/60 bg-white/80 p-2 shadow-2xl shadow-slate-300/50 backdrop-blur">
                <div className="rounded-[1.7rem] border border-slate-200 bg-white">
                  <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
                      <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                      <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                    </div>
                    <div className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                      Mon Cahier
                    </div>
                  </div>

                  <Image
                    src="/accueil.png"
                    alt="Interface Mon Cahier"
                    width={1200}
                    height={850}
                    priority
                    className="h-auto w-full rounded-b-[1.7rem] object-cover"
                  />
                </div>
              </div>

              <div className="absolute -bottom-3 left-4 rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur">
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                  Pilotage
                </div>
                <div className="mt-1 text-sm font-extrabold text-slate-900">
                  Absences + Notes + PrÃ©vision
                </div>
              </div>

              <div className="absolute -right-2 top-6 rounded-2xl border border-indigo-100 bg-indigo-50/95 px-4 py-3 shadow-lg">
                <div className="flex items-center gap-2 text-sm font-extrabold text-indigo-700">
                  <Bell className="h-4 w-4" />
                  Notifications parents
                </div>
              </div>
            </div>
          </div>
        </Container>
      </section>

      {/* Bande bÃ©nÃ©fices */}
      <section className="pt-12">
        <Container>
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
              <div className="inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-indigo-700 ring-1 ring-indigo-200">
                <Building2 className="h-3.5 w-3.5" />
                Pour la direction
              </div>
              <h3 className="mt-4 text-2xl font-black text-slate-900">
                Un vrai poste de pilotage pour lâ€™Ã©tablissement
              </h3>
              <p className="mt-3 text-sm leading-7 text-slate-600">
                Moins de papier, plus de visibilitÃ©, plus de rÃ©activitÃ©.
              </p>
              <div className="mt-6">
                <MiniBenefitList items={directionBenefits} />
              </div>
            </div>

            <div className="rounded-[2rem] border border-slate-200 bg-gradient-to-br from-slate-900 to-slate-800 p-6 text-white shadow-sm sm:p-8">
              <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-white ring-1 ring-white/15">
                <Users className="h-3.5 w-3.5" />
                Pour les parents
              </div>
              <h3 className="mt-4 text-2xl font-black">
                Une relation Ã©cole-famille beaucoup plus fluide
              </h3>
              <p className="mt-3 text-sm leading-7 text-slate-300">
                Les familles suivent mieux le parcours scolaire de leurs
                enfants.
              </p>
              <div className="mt-6">
                <ul className="grid gap-3">
                  {parentBenefits.map((item) => (
                    <li
                      key={item}
                      className="flex items-start gap-3 text-sm text-slate-100"
                    >
                      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </Container>
      </section>

      {/* Comment Ã§a marche */}
      <section id="steps" className="pt-16">
        <Container>
          <SectionTitle
            eyebrow="Comment Ã§a marche"
            title="Un fonctionnement simple, mÃªme Ã  grande Ã©chelle"
            subtitle="La plateforme a Ã©tÃ© pensÃ©e pour les rÃ©alitÃ©s du terrain : rapiditÃ©, clartÃ© et autonomie."
            center
          />

          <div className="mt-10 grid gap-6 lg:grid-cols-2">
            <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
              <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-indigo-700 ring-1 ring-indigo-200">
                <Building2 className="h-3.5 w-3.5" />
                Parcours Ã©tablissement
              </div>

              <div className="grid gap-4">
                <StepCard
                  number="1"
                  title="Mise en place de la structure"
                  desc="Lâ€™Ã©tablissement crÃ©e ses classes, matiÃ¨res, comptes enseignants et contacts parents, avec import CSV si besoin."
                />
                <StepCard
                  number="2"
                  title="Organisation pÃ©dagogique"
                  desc="Les disciplines sont affectÃ©es aux enseignants, puis les espaces deviennent opÃ©rationnels sans mÃ©lange de rÃ´les."
                />
                <StepCard
                  number="3"
                  title="Exploitation quotidienne"
                  desc="Les appels, notes et Ã©valuations alimentent les tableaux de bord, les bulletins et la prÃ©diction du taux de rÃ©ussite."
                />
              </div>
            </div>

            <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
              <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-700 ring-1 ring-emerald-200">
                <Users className="h-3.5 w-3.5" />
                Parcours parent
              </div>

              <div className="grid gap-4">
                <StepCard
                  number="1"
                  title="Connexion Ã  lâ€™espace parent"
                  desc="Le parent accÃ¨de Ã  son interface depuis son smartphone dans un environnement simple et clair."
                  tone="emerald"
                />
                <StepCard
                  number="2"
                  title="Association Ã  lâ€™enfant"
                  desc="Selon lâ€™organisation de lâ€™Ã©tablissement, le parent retrouve les informations liÃ©es au profil scolaire de son enfant."
                  tone="emerald"
                />
                <StepCard
                  number="3"
                  title="Suivi continu"
                  desc="Il consulte les absences, retards, notes, moyennes et bulletins sans dÃ©pendre dâ€™un retour papier."
                  tone="emerald"
                />
              </div>
            </div>
          </div>
        </Container>
      </section>

      {/* Features */}
      <section id="features" className="pt-16">
        <Container>
          <SectionTitle
            eyebrow="FonctionnalitÃ©s clÃ©s"
            title="Tout ce quâ€™il faut pour moderniser le suivi scolaire"
            subtitle="Mon Cahier ne se limite pas aux notes : il structure la vie pÃ©dagogique et renforce la communication avec les parents."
            center
          />

          <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {features.map((feature) => (
              <FeatureCard key={feature.title} {...feature} />
            ))}
          </div>
        </Container>
      </section>

      {/* TÃ©moignages */}
      <section id="testimonials" className="pt-16">
        <Container>
          <SectionTitle
            eyebrow="Confiance"
            title="Des retours qui parlent du terrain"
            subtitle="Chefs dâ€™Ã©tablissement, enseignants et Ã©quipes pÃ©dagogiques apprÃ©cient surtout la lisibilitÃ© et le gain de temps."
            center
          />

          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {testimonials.map((item) => (
              <article
                key={item.quote}
                className={`flex h-full flex-col rounded-[2rem] p-6 shadow-sm ring-1 ${item.tone}`}
              >
                <div
                  className={`mb-4 inline-flex h-10 w-10 items-center justify-center rounded-2xl ${item.iconTone}`}
                >
                  <Quote className="h-4 w-4" />
                </div>
                <p className="text-sm leading-7 text-slate-700">{item.quote}</p>
                <p className="mt-5 text-xs font-black uppercase tracking-[0.14em] text-slate-500">
                  {item.author}
                </p>
              </article>
            ))}
          </div>
        </Container>
      </section>

      {/* FAQ */}
      <section id="faq" className="pt-16">
        <Container>
          <div className="grid gap-8 xl:grid-cols-2">
            <div>
              <SectionTitle
                eyebrow="FAQ"
                title="Sâ€™abonner"
                subtitle="Les rÃ©ponses aux questions les plus frÃ©quentes concernant la mise en route."
              />
              <div className="mt-6">
                <Accordion items={subscribeFaq} />
              </div>
            </div>

            <div>
              <SectionTitle
                eyebrow="FAQ"
                title="GÃ©rer son abonnement"
                subtitle="Des Ã©lÃ©ments simples pour comprendre la gestion courante cÃ´tÃ© Ã©tablissement."
              />
              <div className="mt-6">
                <Accordion items={manageFaq} />
              </div>
            </div>
          </div>
        </Container>
      </section>

      {/* CTA */}
      <section id="contact" className="pt-16 pb-20">
        <Container>
          <div className="relative overflow-hidden rounded-[2rem] border border-indigo-200 bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 p-[1px] shadow-2xl shadow-indigo-200/50">
            <div className="rounded-[calc(2rem-1px)] bg-white/95 p-6 backdrop-blur sm:p-8 lg:p-10">
              <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                <div className="max-w-3xl">
                  <div className="inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-indigo-700 ring-1 ring-indigo-200">
                    <Sparkles className="h-3.5 w-3.5" />
                    Mise en route
                  </div>
                  <h3 className="mt-4 text-2xl font-black text-slate-900 sm:text-3xl">
                    Parlons de votre Ã©tablissement
                  </h3>
                  <p className="mt-3 text-sm leading-7 text-slate-600 sm:text-base">
                    Nous vous accompagnons pour le dÃ©marrage, puis vous gardez la
                    main sur vos classes, vos enseignants, votre cahier de notes
                    et votre suivi administratif.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <a
                    href="https://wa.me/2250720672094?text=Bonjour%20Mon%20Cahier%2C%20je%20souhaite%20m%E2%80%99abonner."
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-extrabold text-white shadow-sm transition hover:bg-emerald-700"
                  >
                    <MessageSquare className="h-4 w-4" />
                    WhatsApp
                  </a>

                  <a
                    href="tel:+2250713023762"
                    className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-extrabold text-slate-800 transition hover:bg-slate-50"
                  >
                    <PhoneCall className="h-4 w-4" />
                    Appeler
                  </a>
                </div>
              </div>
            </div>
          </div>
        </Container>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-slate-950 py-12 text-slate-100">
        <Container>
          <div className="grid gap-10 md:grid-cols-3">
            <div>
              <div className="text-2xl font-black">Mon Cahier</div>
              <div className="mt-2 text-sm text-slate-400">
                Absences, notes, bulletins et pilotage intelligent de
                lâ€™Ã©tablissement.
              </div>
              <div className="mt-3 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                ConÃ§u et dÃ©veloppÃ© par{" "}
                <span className="text-slate-200">NEXA DIGITAL SARL</span>
              </div>
            </div>

            <div>
              <div className="text-lg font-extrabold">Navigation</div>
              <ul className="mt-4 space-y-3 text-sm text-slate-300">
                <li>
                  <a href="#hero" className="transition hover:text-white">
                    Accueil
                  </a>
                </li>
                <li>
                  <a href="#features" className="transition hover:text-white">
                    FonctionnalitÃ©s
                  </a>
                </li>
                <li>
                  <a href="#steps" className="transition hover:text-white">
                    Comment Ã§a marche
                  </a>
                </li>
                <li>
                  <a href="#faq" className="transition hover:text-white">
                    FAQ
                  </a>
                </li>
              </ul>
            </div>

            <div>
              <div className="text-lg font-extrabold">Contact</div>
              <div className="mt-4 space-y-3 text-sm text-slate-300">
                <div>WhatsApp : 07 20 67 20 94</div>
                <div>Appel : +225 07 13 02 37 62</div>
                <div>Email : moncahier.ci@gmail.com</div>
              </div>
            </div>
          </div>

          <div className="mt-10 border-t border-white/10 pt-5 text-xs text-slate-500">
            Copyright Â© {new Date().getFullYear()} Mon Cahier Â· Tous droits
            rÃ©servÃ©s
          </div>
        </Container>
      </footer>

      {/* bouton top */}
      <a
        href="#hero"
        aria-label="Revenir en haut"
        className="fixed bottom-6 right-6 z-30 grid h-12 w-12 place-items-center rounded-full bg-slate-900 text-white shadow-xl shadow-slate-300 transition hover:-translate-y-1 hover:bg-indigo-600"
      >
        <ArrowUp className="h-5 w-5" />
      </a>
    </main>
  );
}
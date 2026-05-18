// src/app/page.tsx
"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./providers";
import {
  ArrowRight,
  ArrowUp,
  BadgeCheck,
  Bell,
  Building2,
  Clock,
  FileSpreadsheet,
  Landmark,
  MessageSquare,
  PhoneCall,
  Quote,
  ReceiptText,
  Rocket,
  Shield,
  UserCog,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

type FaqItem = { q: string; a: ReactNode };

function SectionTitle({
  id,
  eyebrow,
  title,
  description,
}: {
  id?: string;
  eyebrow: string;
  title: string;
  description?: string;
}) {
  return (
    <div id={id} className="scroll-mt-24">
      <div className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">
        {eyebrow}
      </div>
      <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-900 md:text-4xl">
        {title}
      </h2>
      {description ? (
        <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600 md:text-[15px]">
          {description}
        </p>
      ) : null}
    </div>
  );
}

function Accordion({ items }: { items: FaqItem[] }) {
  return (
    <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
      {items.map((it, i) => (
        <details key={i} className="group border-b border-slate-200 last:border-b-0">
          <summary className="flex cursor-pointer list-none items-start gap-3 px-5 py-5 text-left">
            <span className="mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 transition group-open:rotate-45">
              +
            </span>
            <span className="pr-2 text-sm font-black text-slate-900 md:text-[15px]">
              {it.q}
            </span>
          </summary>
          <div className="px-5 pb-5 pl-16 text-sm leading-7 text-slate-600">{it.a}</div>
        </details>
      ))}
    </div>
  );
}

function ContactCTA() {
  const wa =
    "https://wa.me/2250720672094?text=Bonjour%20Mon%20Cahier%2C%20je%20souhaite%20avoir%20une%20pr%C3%A9sentation.";

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <a
        href={wa}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-emerald-700"
      >
        <MessageSquare className="h-4 w-4" />
        Écrire sur WhatsApp
      </a>

      <a
        href="tel:+2250713023762"
        className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50"
      >
        <PhoneCall className="h-4 w-4" />
        Appeler
      </a>

      <a href="mailto:moncahier.ci@gmail.com" className="text-sm font-bold text-emerald-700 hover:underline">
        moncahier.ci@gmail.com
      </a>
    </div>
  );
}

function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-bold text-emerald-100 ring-1 ring-emerald-400/25">
      {children}
    </span>
  );
}

function StatCard({
  icon,
  label,
  value,
  hint,
  tone = "slate",
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint: string;
  tone?: "slate" | "emerald" | "amber" | "violet";
}) {
  const tones = {
    slate: {
      wrap: "border-slate-200 bg-white",
      iconWrap: "bg-slate-100 text-slate-700",
      value: "text-slate-900",
    },
    emerald: {
      wrap: "border-emerald-200 bg-emerald-50/60",
      iconWrap: "bg-emerald-100 text-emerald-700",
      value: "text-emerald-800",
    },
    amber: {
      wrap: "border-amber-200 bg-amber-50/70",
      iconWrap: "bg-amber-100 text-amber-700",
      value: "text-amber-800",
    },
    violet: {
      wrap: "border-violet-200 bg-violet-50/70",
      iconWrap: "bg-violet-100 text-violet-700",
      value: "text-violet-800",
    },
  } as const;

  const t = tones[tone];

  return (
    <div className={`rounded-3xl border p-4 shadow-sm ${t.wrap}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">{label}</div>
          <div className={`mt-2 text-2xl font-black sm:text-3xl ${t.value}`}>{value}</div>
          <div className="mt-1 text-sm text-slate-600">{hint}</div>
        </div>
        <div className={`grid h-12 w-12 place-items-center rounded-2xl ${t.iconWrap}`}>{icon}</div>
      </div>
    </div>
  );
}

function SpaceCard({
  href,
  icon: Icon,
  title,
  description,
  badge,
  tone = "emerald",
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  description: string;
  badge?: string;
  tone?: "emerald" | "slate" | "amber" | "violet";
}) {
  const tones = {
    emerald: "bg-emerald-50 text-emerald-700",
    slate: "bg-slate-100 text-slate-700",
    amber: "bg-amber-50 text-amber-700",
    violet: "bg-violet-50 text-violet-700",
  } as const;

  return (
    <Link
      href={href}
      className="group rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className={`grid h-11 w-11 place-items-center rounded-2xl ${tones[tone]}`}>
            <Icon className="h-5 w-5" />
          </div>

          <h3 className="mt-4 text-lg font-black text-slate-900">{title}</h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
        </div>

        <div className="flex flex-col items-end gap-2">
          {badge ? (
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-700 ring-1 ring-slate-200">
              {badge}
            </span>
          ) : null}
          <ArrowRight className="h-5 w-5 text-slate-400 transition group-hover:translate-x-0.5" />
        </div>
      </div>
    </Link>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  desc,
  tone = "emerald",
}: {
  icon: LucideIcon;
  title: string;
  desc: string;
  tone?: "emerald" | "slate" | "amber" | "violet";
}) {
  const tones = {
    emerald: "bg-emerald-50 text-emerald-700",
    slate: "bg-slate-100 text-slate-700",
    amber: "bg-amber-50 text-amber-700",
    violet: "bg-violet-50 text-violet-700",
  } as const;

  return (
    <article className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start gap-4">
        <div className={`grid h-11 w-11 place-items-center rounded-2xl ${tones[tone]}`}>
          <Icon className="h-5 w-5" />
        </div>

        <div>
          <h3 className="text-lg font-black text-slate-900">{title}</h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">{desc}</p>
        </div>
      </div>
    </article>
  );
}

function StepCard({
  tone = "emerald",
  icon: Icon,
  title,
  steps,
}: {
  tone?: "emerald" | "slate";
  icon: LucideIcon;
  title: string;
  steps: string[];
}) {
  const theme =
    tone === "emerald"
      ? {
          iconWrap: "bg-emerald-50 text-emerald-700",
          bullet: "bg-emerald-600 text-white",
          title: "text-emerald-700",
        }
      : {
          iconWrap: "bg-slate-100 text-slate-700",
          bullet: "bg-slate-900 text-white",
          title: "text-slate-700",
        };

  return (
    <article className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
      <div className={`inline-flex items-center gap-2 text-sm font-black ${theme.title}`}>
        <span className={`grid h-9 w-9 place-items-center rounded-2xl ${theme.iconWrap}`}>
          <Icon className="h-4 w-4" />
        </span>
        {title}
      </div>

      <ol className="mt-5 grid gap-4">
        {steps.map((step, index) => (
          <li key={index} className="flex items-start gap-3 text-sm leading-7 text-slate-600">
            <span className={`mt-0.5 inline-grid h-7 w-7 flex-none place-items-center rounded-full text-xs font-black ${theme.bullet}`}>
              {index + 1}
            </span>
            <span dangerouslySetInnerHTML={{ __html: step }} />
          </li>
        ))}
      </ol>
    </article>
  );
}

function TestimonialCard({
  quote,
  author,
  tone = "emerald",
}: {
  quote: string;
  author: string;
  tone?: "emerald" | "slate" | "violet";
}) {
  const tones = {
    emerald: {
      ring: "ring-emerald-100",
      icon: "bg-emerald-50 text-emerald-700",
      author: "text-emerald-800",
    },
    slate: {
      ring: "ring-slate-200",
      icon: "bg-slate-100 text-slate-700",
      author: "text-slate-800",
    },
    violet: {
      ring: "ring-violet-100",
      icon: "bg-violet-50 text-violet-700",
      author: "text-violet-800",
    },
  } as const;

  const t = tones[tone];

  return (
    <article className={`flex h-full flex-col rounded-[28px] bg-white p-5 shadow-sm ring-1 ${t.ring}`}>
      <div className={`mb-4 inline-flex h-10 w-10 items-center justify-center rounded-full ${t.icon}`}>
        <Quote className="h-4 w-4" />
      </div>
      <p className="text-sm leading-7 text-slate-600">{quote}</p>
      <p className={`mt-5 text-xs font-black uppercase tracking-[0.12em] ${t.author}`}>{author}</p>
    </article>
  );
}

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

  const subscribeFaq: FaqItem[] = [
    {
      q: "Comment démarrer avec Mon Cahier ?",
      a: (
        <>
          L’établissement est accompagné au départ, puis il devient autonome pour créer ses classes,
          enseignants, matières, frais scolaires et accès parents.
          <ContactCTA />
        </>
      ),
    },
    {
      q: "Quels modules sont désormais couverts ?",
      a: (
        <ul className="ml-5 list-disc space-y-1.5">
          <li>Absences, retards, présences en classe et suivi des créneaux.</li>
          <li>Notes, moyennes, bulletins, exports et publication officielle.</li>
          <li>Gestion financière : inscriptions, scolarité, paiements, reçus, dépenses et paie.</li>
          <li>Espace parent, enseignant, direction, finance, fondateur et supervision.</li>
          <li>Prédiction scolaire et tableaux de bord de pilotage.</li>
        </ul>
      ),
    },
  ];

  const manageFaq: FaqItem[] = [
    {
      q: "Le profil fondateur utilise-t-il le même écran que les autres ?",
      a: (
        <>
          Non. Depuis l’accueil, l’accès fondateur ouvre une connexion clairement identifiée, puis le rôle
          <b> founder</b> est redirigé vers son tableau de bord multi-écoles.
        </>
      ),
    },
    {
      q: "Le gestionnaire financier peut-il aller directement dans son espace ?",
      a: (
        <>
          Oui. L’entrée finance ouvre une connexion dédiée et le rôle <b>finance_manager</b> est envoyé vers
          la gestion financière de l’établissement.
        </>
      ),
    },
  ];

  return (
    <main className="relative min-h-screen bg-slate-50 text-slate-900">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute left-[5%] top-[-10%] h-56 w-56 rounded-full bg-emerald-200/25 blur-3xl md:h-72 md:w-72" />
        <div className="absolute right-[-5%] top-[25%] h-64 w-64 rounded-full bg-slate-300/20 blur-3xl md:h-80 md:w-80" />
        <div className="absolute bottom-[-15%] left-[15%] h-60 w-60 rounded-full bg-sky-200/20 blur-3xl md:h-72 md:w-72" />
      </div>

      <header className="sticky top-0 z-30 w-full border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <a href="#hero" className="flex min-w-0 shrink-0 items-center gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
              <Shield className="h-5 w-5" />
            </div>

            <div className="min-w-0 text-slate-900">
              <div className="text-sm font-black tracking-wide">Mon Cahier</div>
              <div className="hidden text-xs text-slate-500 sm:block">École, finances &amp; pilotage en temps réel</div>
            </div>
          </a>

          <nav className="hidden items-center gap-4 text-sm font-bold text-slate-700 lg:flex">
            <a href="#spaces" className="hover:text-emerald-700">Espaces</a>
            <a href="#modules" className="hover:text-emerald-700">Modules</a>
            <a href="#steps" className="hover:text-emerald-700">Déploiement</a>
            <a href="#faq" className="hover:text-emerald-700">FAQ</a>
            <a href="#contact" className="hover:text-emerald-700">Contact</a>
          </nav>

          <div className="hidden shrink-0 items-center gap-2 xl:flex">
            <Link
              href="/parents/login"
              className="inline-flex items-center gap-2 rounded-full border border-emerald-500 bg-white px-3 py-2 text-[11px] font-black text-emerald-700 shadow-sm hover:bg-emerald-50"
            >
              <Users className="h-4 w-4" />
              <span>Parent</span>
            </Link>

            <Link
              href="/login?space=enseignant"
              className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-2 text-[11px] font-black text-slate-700 hover:border-slate-400 hover:bg-slate-50"
            >
              <FileSpreadsheet className="h-4 w-4" />
              <span>Enseignant</span>
            </Link>

            <Link
              href="/login?space=direction"
              className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-2 text-[11px] font-black text-slate-700 hover:border-slate-400 hover:bg-slate-50"
            >
              <Building2 className="h-4 w-4" />
              <span>Direction</span>
            </Link>

            <Link
              href="/login?space=finance"
              className="inline-flex items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] font-black text-amber-800 hover:bg-amber-100"
            >
              <Wallet className="h-4 w-4" />
              <span>Finance</span>
            </Link>

            <Link
              href="/login?space=fondateur"
              className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-3 py-2 text-[11px] font-black text-white shadow-sm hover:bg-slate-800"
            >
              <UserCog className="h-4 w-4" />
              <span>Fondateur</span>
            </Link>
          </div>

          <a
            href="#spaces"
            className="inline-flex shrink-0 items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-slate-800 xl:hidden"
          >
            Se connecter
          </a>
        </div>
      </header>

      <section className="border-b border-slate-200 bg-slate-900 text-slate-100">
        <div className="mx-auto max-w-7xl px-4 py-3 text-center text-sm font-medium tracking-wide">
          Mon Cahier réunit assiduité, notes, finances, bulletins, supervision et prédiction scolaire.
        </div>
      </section>

      <section id="hero" className="px-4 pb-6 pt-6 md:pb-8 md:pt-8">
        <div className="mx-auto max-w-7xl overflow-hidden rounded-[32px] border border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 px-6 py-7 text-white shadow-xl md:px-8 md:py-8">
          <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="max-w-3xl">
              <Pill>
                <Rocket className="h-3.5 w-3.5" />
                <span>Plateforme complète de pilotage scolaire</span>
              </Pill>

              <h1 className="mt-4 text-4xl font-black leading-tight tracking-tight sm:text-5xl">
                Une seule plateforme pour gérer
                <span className="block text-emerald-300">l’école, les résultats et les finances</span>
              </h1>

              <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-200 sm:text-[15px]">
                Mon Cahier centralise les appels, notes, bulletins, paiements, reçus, dépenses,
                paie du personnel, supervision fondateur et prédiction scolaire dans des espaces séparés par rôle.
              </p>

              <div className="mt-5 flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-200">
                <span className="rounded-full bg-emerald-500/15 px-3 py-1 ring-1 ring-emerald-400/25">
                  Gestion financière intégrée
                </span>
                <span className="rounded-full bg-white/10 px-3 py-1 ring-1 ring-white/15">
                  Espace fondateur multi-écoles
                </span>
                <span className="rounded-full bg-white/10 px-3 py-1 ring-1 ring-white/15">
                  Connexion par profil
                </span>
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <a
                  href="#spaces"
                  className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-5 py-3 text-sm font-black text-white shadow-sm hover:bg-emerald-700"
                >
                  Choisir mon espace
                  <ArrowRight className="h-4 w-4" />
                </a>

                <a
                  href="#modules"
                  className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-5 py-3 text-sm font-black text-white hover:bg-white/15"
                >
                  Voir les modules
                </a>
              </div>
            </div>

            <div className="relative">
              <div className="rounded-[28px] border border-white/10 bg-white/10 p-3 backdrop-blur">
                <div className="overflow-hidden rounded-[24px] border border-slate-200/10 bg-slate-950/40">
                  <Image
                    src="/accueil.png"
                    alt="Interface Mon Cahier : pilotage scolaire et gestion financière"
                    width={900}
                    height={600}
                    className="h-auto w-full object-cover"
                    priority
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            icon={<Clock className="h-6 w-6" />}
            label="Assiduité"
            value="Temps réel"
            hint="Appels, retards, présences et créneaux"
            tone="slate"
          />
          <StatCard
            icon={<FileSpreadsheet className="h-6 w-6" />}
            label="Pédagogie"
            value="Notes & bulletins"
            hint="Moyennes, exports et publication"
            tone="emerald"
          />
          <StatCard
            icon={<Wallet className="h-6 w-6" />}
            label="Finance"
            value="Paiements"
            hint="Frais, reçus, dépenses et paie"
            tone="amber"
          />
          <StatCard
            icon={<UserCog className="h-6 w-6" />}
            label="Fondateur"
            value="Multi-écoles"
            hint="Vue consolidée et supervision"
            tone="violet"
          />
        </div>
      </section>

      <section id="spaces" className="mx-auto max-w-7xl px-4 py-6 md:py-8">
        <SectionTitle
          eyebrow="Espaces de connexion"
          title="Chaque profil entre par le bon espace"
          description="La page d’accueil présente maintenant les accès réellement disponibles : parent, enseignant, direction, finance et fondateur."
        />

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <SpaceCard
            href="/parents/login"
            icon={Users}
            title="Parent"
            description="Consulter absences, retards, notes, moyennes et bulletins depuis le téléphone."
            badge="Famille"
            tone="emerald"
          />
          <SpaceCard
            href="/login?space=enseignant"
            icon={FileSpreadsheet}
            title="Enseignant"
            description="Faire l’appel, saisir les notes et suivre les classes affectées."
            badge="Classe"
            tone="slate"
          />
          <SpaceCard
            href="/login?space=direction"
            icon={Building2}
            title="Direction"
            description="Piloter l’établissement : classes, enseignants, bulletins, exports et statistiques."
            badge="Admin"
            tone="violet"
          />
          <SpaceCard
            href="/login?space=finance"
            icon={Wallet}
            title="Finance"
            description="Gérer inscriptions, scolarité, paiements, reçus, dépenses et paie."
            badge="Gestion"
            tone="amber"
          />
          <SpaceCard
            href="/login?space=fondateur"
            icon={UserCog}
            title="Fondateur"
            description="Suivre plusieurs établissements, les créneaux, la présence et les finances consolidées."
            badge="Multi-écoles"
            tone="slate"
          />
        </div>
      </section>

      <section id="modules" className="mx-auto max-w-7xl px-4 py-6 md:py-8">
        <SectionTitle
          eyebrow="Modules clés"
          title="Mon Cahier a grandi : l’accueil doit le montrer clairement"
          description="La plateforme n’est plus seulement un cahier d’absences et de notes. Elle couvre désormais plusieurs dimensions de la gestion scolaire."
        />

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <FeatureCard
            icon={Clock}
            title="Assiduité et présence en classe"
            desc="Appels par créneau, retards, absences, présence des enseignants et suivi des cours effectués."
            tone="slate"
          />
          <FeatureCard
            icon={FileSpreadsheet}
            title="Notes, moyennes et bulletins"
            desc="Évaluations, moyennes, publication officielle, bulletins, signatures et exports administratifs."
            tone="emerald"
          />
          <FeatureCard
            icon={Wallet}
            title="Gestion financière"
            desc="Frais d’inscription, scolarité, autres frais, paiements, reçus, dépenses, rapports et paie."
            tone="amber"
          />
          <FeatureCard
            icon={ReceiptText}
            title="Reçus et paiements en ligne"
            desc="Suivi des encaissements, reçus imprimables et préparation de la réconciliation des paiements."
            tone="amber"
          />
          <FeatureCard
            icon={Landmark}
            title="Supervision fondateur"
            desc="Vue globale des établissements rattachés, alertes, statistiques de présence et finance consolidée."
            tone="violet"
          />
          <FeatureCard
            icon={Rocket}
            title="Prédiction scolaire"
            desc="Analyse des notes, absences et indicateurs pédagogiques pour aider la direction à anticiper."
            tone="emerald"
          />
          <FeatureCard
            icon={Bell}
            title="Notifications parents"
            desc="Alertes rapides pour les absences, retards, notes publiées et informations importantes."
            tone="slate"
          />
          <FeatureCard
            icon={Shield}
            title="Rôles séparés et sécurité"
            desc="Aucun mélange entre direction, enseignant, finance, parent, fondateur et supervision."
            tone="violet"
          />
          <FeatureCard
            icon={BadgeCheck}
            title="Pilotage administratif"
            desc="Tableaux de bord, états, exports et indicateurs pour mieux suivre le fonctionnement de l’école."
            tone="emerald"
          />
        </div>
      </section>

      <section id="steps" className="mx-auto max-w-7xl px-4 py-6 md:py-8">
        <SectionTitle
          eyebrow="Déploiement"
          title="Une organisation claire dès le départ"
          description="L’établissement paramètre ses données, puis chaque profil travaille uniquement dans son périmètre."
        />

        <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
          <StepCard
            tone="slate"
            icon={Building2}
            title="Établissement"
            steps={[
              "Créer les classes, matières, enseignants, élèves et responsables <b>(import possible)</b>.",
              "Définir les frais scolaires avant les inscriptions pour éviter les saisies incohérentes.",
              "Suivre ensuite les absences, notes, finances, bulletins et indicateurs depuis les tableaux de bord.",
            ]}
          />

          <StepCard
            tone="emerald"
            icon={UserCog}
            title="Fondateur et finance"
            steps={[
              "Le fondateur accède à une vue consolidée des établissements qui lui sont rattachés.",
              "Le gestionnaire financier traite les paiements, reçus, dépenses, rapports et paie sans mélanger les rôles.",
              "Les directions gardent le contrôle des paramètres sensibles de leur établissement.",
            ]}
          />
        </div>
      </section>

      <section id="testimonials" className="mx-auto max-w-7xl px-4 py-6 md:py-8">
        <SectionTitle
          eyebrow="Terrain"
          title="Une solution construite autour des besoins réels des écoles"
          description="Mon Cahier évolue avec les demandes concrètes des directions, fondateurs, enseignants et parents."
        />

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <TestimonialCard
            quote="« Les retards et absences sont enfin suivis sérieusement, sans piles de papiers. »"
            author="Direction d’établissement"
            tone="emerald"
          />
          <TestimonialCard
            quote="« Le suivi financier devient plus clair quand les frais, paiements et reçus sont centralisés. »"
            author="Gestion financière"
            tone="slate"
          />
          <TestimonialCard
            quote="« La vue fondateur permet de voir rapidement ce qui se passe dans les établissements. »"
            author="Pilotage multi-écoles"
            tone="violet"
          />
        </div>
      </section>

      <section id="faq" className="mx-auto max-w-7xl px-4 py-6 md:py-8">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          <div>
            <SectionTitle eyebrow="FAQ" title="Démarrer" />
            <div className="mt-6">
              <Accordion items={subscribeFaq} />
            </div>
          </div>

          <div>
            <SectionTitle eyebrow="FAQ" title="Connexions" />
            <div className="mt-6">
              <Accordion items={manageFaq} />
            </div>
          </div>
        </div>
      </section>

      <section id="contact" className="mx-auto max-w-7xl px-4 pb-20 pt-6 md:pt-8">
        <div className="relative overflow-hidden rounded-[32px] border border-slate-200 bg-gradient-to-r from-slate-950 via-slate-900 to-emerald-950 p-6 text-white shadow-xl md:p-8">
          <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
            <div className="max-w-3xl">
              <div className="text-xs font-black uppercase tracking-[0.18em] text-emerald-300">Contact</div>
              <h3 className="mt-3 text-3xl font-black tracking-tight">Présenter Mon Cahier à votre établissement</h3>
              <p className="mt-3 text-sm leading-7 text-slate-200 md:text-[15px]">
                Assiduité, notes, finances, bulletins, supervision fondateur et prédiction scolaire :
                tout peut être présenté de façon claire selon les besoins de votre école.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <a
                href="https://wa.me/2250720672094?text=Bonjour%20Mon%20Cahier%2C%20je%20souhaite%20avoir%20une%20pr%C3%A9sentation."
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-emerald-700"
              >
                <MessageSquare className="h-4 w-4" />
                WhatsApp
              </a>

              <a
                href="tel:+2250713023762"
                className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-bold text-white hover:bg-white/15"
              >
                <PhoneCall className="h-4 w-4" />
                Appeler
              </a>
            </div>
          </div>
        </div>
      </section>

      <footer className="bg-slate-900 py-12 text-slate-100">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-10 px-4 md:grid-cols-3">
          <div>
            <div className="text-2xl font-black">Mon Cahier</div>
            <div className="mt-1 text-slate-400">Copyrights © {new Date().getFullYear()}</div>
            <div className="mt-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-300">
              Conçu et développé par <span className="text-white">NEXA DIGITAL SARL</span>
            </div>
          </div>

          <div>
            <h3 className="text-lg font-black">Navigation</h3>
            <ul className="mt-4 space-y-2 text-sm text-slate-300">
              <li><a href="#spaces" className="hover:text-white">Espaces de connexion</a></li>
              <li><a href="#modules" className="hover:text-white">Modules</a></li>
              <li><a href="#steps" className="hover:text-white">Déploiement</a></li>
              <li><a href="#faq" className="hover:text-white">FAQ</a></li>
            </ul>
          </div>

          <div>
            <h3 className="text-lg font-black">Nous contacter</h3>
            <div className="mt-4 space-y-2 text-sm text-slate-300">
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

      <a
        href="#hero"
        className="fixed bottom-6 right-6 grid h-12 w-12 place-items-center rounded-full bg-slate-900 text-white shadow-lg ring-1 ring-slate-300 transition hover:bg-slate-800"
        aria-label="Revenir en haut"
      >
        <ArrowUp className="h-5 w-5" />
      </a>
    </main>
  );
}

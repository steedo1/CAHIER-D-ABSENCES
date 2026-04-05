// src/app/page.tsx
"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
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
        <details
          key={i}
          className="group border-b border-slate-200 last:border-b-0"
        >
          <summary className="flex cursor-pointer list-none items-start gap-3 px-5 py-5 text-left">
            <span className="mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 transition group-open:rotate-45">
              +
            </span>
            <span className="pr-2 text-sm font-black text-slate-900 md:text-[15px]">
              {it.q}
            </span>
          </summary>
          <div className="px-5 pb-5 pl-16 text-sm leading-7 text-slate-600">
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
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <a
        href={wa}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-emerald-700"
      >
        <MessageSquare className="h-4 w-4" />
        Démarrer sur WhatsApp
      </a>

      <a
        href="tel:+2250713023762"
        className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50"
      >
        <PhoneCall className="h-4 w-4" />
        Appeler le commercial
      </a>

      <a
        href="mailto:moncahier.ci@gmail.com"
        className="text-sm font-bold text-emerald-700 hover:underline"
      >
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
          <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
            {label}
          </div>
          <div className={`mt-2 text-2xl font-black sm:text-3xl ${t.value}`}>
            {value}
          </div>
          <div className="mt-1 text-sm text-slate-600">{hint}</div>
        </div>
        <div
          className={`grid h-12 w-12 place-items-center rounded-2xl ${t.iconWrap}`}
        >
          {icon}
        </div>
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
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  description: string;
  badge?: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">
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
}: {
  icon: LucideIcon;
  title: string;
  desc: string;
}) {
  return (
    <article className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start gap-4">
        <div className="grid h-11 w-11 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">
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
            <span
              className={`mt-0.5 inline-grid h-7 w-7 flex-none place-items-center rounded-full text-xs font-black ${theme.bullet}`}
            >
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
      <p className={`mt-5 text-xs font-black uppercase tracking-[0.12em] ${t.author}`}>
        {author}
      </p>
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
        <ul className="ml-5 list-disc space-y-1.5">
          <li>
            Création autonome des <b>classes</b> et des <b>comptes enseignants</b>.
          </li>
          <li>
            Contacts parents reliés aux élèves et <b>notifications temps réel</b>.
          </li>
          <li>
            <b>Suivi des heures effectuées</b> par enseignant sur une période donnée.
          </li>
          <li>
            <b>Cahier de notes complet</b> : devoirs, interrogations, moyennes et bulletins.
          </li>
          <li>
            <b>Tableaux de bord</b> clairs et exports CSV.
          </li>
          <li>
            Import facile (CSV) des <b>classes</b>, <b>enseignants</b> et élèves.
          </li>
          <li>
            Affectations <b>en masse</b> des disciplines aux enseignants.
          </li>
          <li>
            Rôles clairs : super admin, admin d’établissement, enseignant, parent.
          </li>
          <li>
            <b>Modèle de prédiction</b> du taux de réussite par classe.
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

  return (
    <main className="relative min-h-screen bg-slate-50 text-slate-900">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute left-[5%] top-[-10%] h-56 w-56 rounded-full bg-emerald-200/25 blur-3xl md:h-72 md:w-72" />
        <div className="absolute right-[-5%] top-[25%] h-64 w-64 rounded-full bg-slate-300/20 blur-3xl md:h-80 md:w-80" />
        <div className="absolute bottom-[-15%] left-[15%] h-60 w-60 rounded-full bg-sky-200/20 blur-3xl md:h-72 md:w-72" />
      </div>

      <header className="sticky top-0 z-30 w-full border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <a href="#hero" className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
              <Shield className="h-5 w-5" />
            </div>

            <div className="text-slate-900">
              <div className="text-sm font-black tracking-wide">Mon Cahier</div>
              <div className="text-xs text-slate-500">
                Absences, notes &amp; prédiction des résultats
              </div>
            </div>
          </a>

          <nav className="hidden items-center gap-6 text-sm font-bold text-slate-700 md:flex">
            <a href="#spaces" className="hover:text-emerald-700">
              Espaces
            </a>
            <a href="#features" className="hover:text-emerald-700">
              Fonctionnalités
            </a>
            <a href="#steps" className="hover:text-emerald-700">
              Comment ça marche
            </a>
            <a href="#faq" className="hover:text-emerald-700">
              FAQ
            </a>
            <a href="#contact" className="hover:text-emerald-700">
              Contact
            </a>
          </nav>

          <div className="hidden items-center gap-3 md:flex">
            <Link
              href="/parents/login"
              className="inline-flex items-center gap-2 rounded-full border border-emerald-500 bg-white px-4 py-2 text-xs font-bold text-emerald-700 shadow-sm hover:bg-emerald-50"
            >
              <Users className="h-4 w-4" />
              <span>Espace parent</span>
            </Link>

            <Link
              href="/login?space=direction"
              className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:border-slate-400 hover:bg-slate-50"
            >
              <Building2 className="h-4 w-4" />
              <span>Espace direction</span>
            </Link>

            <Link
              href="/login?space=enseignant"
              className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-slate-800"
            >
              <FileSpreadsheet className="h-4 w-4" />
              <span>Espace enseignant</span>
            </Link>
          </div>

          <a
            href="#spaces"
            className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-slate-800 md:hidden"
          >
            Se connecter
          </a>
        </div>
      </header>

      <section className="border-b border-slate-200 bg-slate-900 text-slate-100">
        <div className="mx-auto max-w-7xl px-4 py-3 text-center text-sm font-medium tracking-wide">
          Mon Cahier : absences, notes, bulletins et prédiction du taux de réussite dans un seul outil.
        </div>
      </section>

      <section id="hero" className="px-4 pb-6 pt-6 md:pb-8 md:pt-8">
        <div className="mx-auto max-w-7xl overflow-hidden rounded-[32px] border border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 px-6 py-7 text-white shadow-xl md:px-8 md:py-8">
          <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="max-w-3xl">
              <Pill>
                <Rocket className="h-3.5 w-3.5" />
                <span>Solution complète pour les établissements scolaires</span>
              </Pill>

              <h1 className="mt-4 text-4xl font-black leading-tight tracking-tight sm:text-5xl">
                Le cahier d’absences et de notes
                <span className="block text-emerald-300">pensé pour piloter l’école en temps réel</span>
              </h1>

              <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-200 sm:text-[15px]">
                Appel ultra-rapide, cahier de notes complet, bulletins automatiques,
                alertes parents instantanées et <b>modèle de prédiction du taux de réussite</b>
                pour suivre chaque classe avec précision.
              </p>

              <div className="mt-5 flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-200">
                <span className="rounded-full bg-emerald-500/15 px-3 py-1 ring-1 ring-emerald-400/25">
                  Communication parents en temps réel
                </span>
                <span className="rounded-full bg-white/10 px-3 py-1 ring-1 ring-white/15">
                  Interfaces dédiées par rôle
                </span>
                <span className="rounded-full bg-white/10 px-3 py-1 ring-1 ring-white/15">
                  Pilotage pédagogique et administratif
                </span>
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <a
                  href="#spaces"
                  className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-5 py-3 text-sm font-black text-white shadow-sm hover:bg-emerald-700"
                >
                  Choisir un espace
                  <ArrowRight className="h-4 w-4" />
                </a>

                <a
                  href="#contact"
                  className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-5 py-3 text-sm font-black text-white hover:bg-white/15"
                >
                  Parler à l’équipe
                </a>
              </div>
            </div>

            <div className="relative">
              <div className="rounded-[28px] border border-white/10 bg-white/10 p-3 backdrop-blur">
                <div className="overflow-hidden rounded-[24px] border border-slate-200/10 bg-slate-950/40">
                  <Image
                    src="/accueil.png"
                    alt="Interface Mon Cahier : absences, notes et prédiction"
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
            icon={<Users className="h-6 w-6" />}
            label="Parents touchés"
            value="10 000+"
            hint="Suivi mobile simplifié"
            tone="slate"
          />
          <StatCard
            icon={<Clock className="h-6 w-6" />}
            label="Temps d’appel moyen"
            value="< 60 s"
            hint="Saisie rapide en classe"
            tone="emerald"
          />
          <StatCard
            icon={<Bell className="h-6 w-6" />}
            label="Notifications"
            value="250 000+"
            hint="Absences, retards et notes"
            tone="amber"
          />
          <StatCard
            icon={<Rocket className="h-6 w-6" />}
            label="Prédiction"
            value="Modèle intelligent"
            hint="Aide au pilotage des classes"
            tone="violet"
          />
        </div>
      </section>

      <section id="spaces" className="mx-auto max-w-7xl px-4 py-6 md:py-8">
        <SectionTitle
          eyebrow="Espaces de connexion"
          title="Chaque profil dispose de sa propre interface"
          description="Aucune confusion entre les rôles : parent, direction et enseignant accèdent chacun à un espace clair, dédié et cohérent."
        />

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <SpaceCard
            href="/parents/login"
            icon={Users}
            title="Espace parent"
            description="Suivi des absences, retards, notes et bulletins de vos enfants, directement depuis le smartphone."
            badge="Accès mobile"
          />
          <SpaceCard
            href="/login?space=direction"
            icon={Building2}
            title="Espace direction"
            description="Vue globale des classes, enseignants, statistiques, suivi des cours et prédiction du taux de réussite."
            badge="Pilotage"
          />
          <SpaceCard
            href="/login?space=enseignant"
            icon={FileSpreadsheet}
            title="Espace enseignant"
            description="Appel, saisie des notes, moyennes et bulletins en quelques clics, en classe ou à la maison."
            badge="Saisie rapide"
          />
        </div>
      </section>

      <section id="steps" className="mx-auto max-w-7xl px-4 py-6 md:py-8">
        <SectionTitle
          eyebrow="Comment ça marche"
          title="Un déploiement simple, puis une gestion autonome"
          description="Mon Cahier accompagne l’établissement au démarrage, puis laisse une grande autonomie pour l’organisation quotidienne."
        />

        <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
          <StepCard
            tone="slate"
            icon={Building2}
            title="Établissement"
            steps={[
              "Créez vos classes, matières et comptes enseignants <b>(import CSV possible)</b>.",
              "Affectez vos disciplines aux professeurs en un clic pour l’appel et le cahier de notes.",
              "En classe, l’appel et les notes alimentent automatiquement les tableaux de bord et le <b>modèle de prédiction</b>.",
            ]}
          />

          <StepCard
            tone="emerald"
            icon={Users}
            title="Parent"
            steps={[
              "Connectez-vous à l’Espace parent.",
              "Associez votre enfant via son matricule si l’établissement l’exige.",
              "Recevez les alertes d’absence et consultez <b>notes, moyennes et bulletins</b> depuis votre téléphone.",
            ]}
          />
        </div>
      </section>

      <section id="features" className="mx-auto max-w-7xl px-4 py-6 md:py-8">
        <SectionTitle
          eyebrow="Fonctionnalités clés"
          title="Un outil central pour l’assiduité, les notes et le pilotage"
          description="La plateforme réunit dans une seule interface les briques essentielles du suivi scolaire et administratif."
        />

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <FeatureCard
            icon={Clock}
            title="Appel ultra-rapide"
            desc="Démarrez un créneau en un clic et notez absences ou retards en quelques secondes depuis le téléphone de la classe."
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
            desc="Un modèle interne analyse absences, notes et matières clés pour estimer le potentiel de réussite de chaque classe."
          />
          <FeatureCard
            icon={Shield}
            title="Rôles & sécurité"
            desc="Accès sécurisés et vues dédiées : super admin, admin, enseignant, parent ; aucune ambiguïté d’accès."
          />
          <FeatureCard
            icon={Users}
            title="Parents connectés"
            desc="Associez les responsables aux élèves et centralisez la communication autour de l’assiduité et des résultats."
          />
        </div>
      </section>

      <section id="testimonials" className="mx-auto max-w-7xl px-4 py-6 md:py-8">
        <SectionTitle
          eyebrow="Ils nous font confiance"
          title="Une solution pensée pour le terrain"
          description="Chefs d’établissement, responsables pédagogiques et enseignants utilisent déjà Mon Cahier au quotidien."
        />

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <TestimonialCard
            quote="« Les retards et absences sont enfin suivis sérieusement, sans piles de papiers. »"
            author="Proviseur · Lycée public Abidjan"
            tone="emerald"
          />
          <TestimonialCard
            quote="« Les parents nous disent qu’ils se sentent vraiment informés du travail de leurs enfants. »"
            author="Directeur des études · Collège privé à Yopougon"
            tone="slate"
          />
          <TestimonialCard
            quote="« Ce qui est intéressant, c’est qu’on sait si un enseignant est en classe ou pas. »"
            author="Responsable pédagogique · Établissement partenaire"
            tone="violet"
          />
        </div>
      </section>

      <section id="faq" className="mx-auto max-w-7xl px-4 py-6 md:py-8">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          <div>
            <SectionTitle eyebrow="FAQ" title="S’abonner" />
            <div className="mt-6">
              <Accordion items={subscribeFaq} />
            </div>
          </div>

          <div>
            <SectionTitle eyebrow="FAQ" title="Gérer son abonnement" />
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
              <div className="text-xs font-black uppercase tracking-[0.18em] text-emerald-300">
                Contact
              </div>
              <h3 className="mt-3 text-3xl font-black tracking-tight">
                Parlons de votre établissement
              </h3>
              <p className="mt-3 text-sm leading-7 text-slate-200 md:text-[15px]">
                On s’occupe de la mise en route. Vous gardez ensuite la main sur
                les classes, enseignants, matières, cahier de notes, bulletins
                et prédiction du taux de réussite.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <a
                href="https://wa.me/2250720672094?text=Bonjour%20Mon%20Cahier%2C%20je%20souhaite%20m%E2%80%99abonner."
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
            <div className="mt-1 text-slate-400">
              Copyrights © {new Date().getFullYear()}
            </div>
            <div className="mt-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-300">
              Conçu et développé par <span className="text-white">NEXA DIGITAL SARL</span>
            </div>
          </div>

          <div>
            <h3 className="text-lg font-black">Navigation</h3>
            <ul className="mt-4 space-y-2 text-sm text-slate-300">
              <li>
                <a href="#spaces" className="hover:text-white">
                  Espaces de connexion
                </a>
              </li>
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
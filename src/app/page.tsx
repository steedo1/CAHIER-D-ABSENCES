// src/app/page.tsx
"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
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
  HeartPulse,
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
      <div className="text-[11px] font-black uppercase tracking-[0.16em] text-emerald-700 md:text-xs md:tracking-[0.18em]">
        {eyebrow}
      </div>
      <h2 className="mt-2 text-[2rem] font-black leading-tight tracking-tight text-slate-900 md:mt-3 md:text-4xl">
        {title}
      </h2>
      {description ? (
        <p className="mt-3 max-w-3xl text-[15px] leading-7 text-slate-600 md:text-[15px]">
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
    <div className={`rounded-[24px] border p-4 shadow-sm md:rounded-3xl ${t.wrap}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500 md:text-xs md:tracking-[0.18em]">{label}</div>
          <div className={`mt-2 text-[1.65rem] font-black leading-tight sm:text-3xl ${t.value}`}>{value}</div>
          <div className="mt-1 text-sm text-slate-600">{hint}</div>
        </div>
        <div className={`grid h-11 w-11 place-items-center rounded-2xl md:h-12 md:w-12 ${t.iconWrap}`}>{icon}</div>
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
      className="group rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md md:rounded-[28px] md:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className={`grid h-10 w-10 place-items-center rounded-2xl md:h-11 md:w-11 ${tones[tone]}`}>
            <Icon className="h-5 w-5" />
          </div>

          <h3 className="mt-3 text-base font-black text-slate-900 md:mt-4 md:text-lg">{title}</h3>
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
    <article className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md md:rounded-[28px] md:p-5">
      <div className="flex items-start gap-3 md:gap-4">
        <div className={`grid h-10 w-10 flex-none place-items-center rounded-2xl md:h-11 md:w-11 ${tones[tone]}`}>
          <Icon className="h-5 w-5" />
        </div>

        <div>
          <h3 className="text-base font-black text-slate-900 md:text-lg">{title}</h3>
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
    <article className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm md:rounded-[28px] md:p-6">
      <div className={`inline-flex items-center gap-2 text-sm font-black ${theme.title}`}>
        <span className={`grid h-9 w-9 place-items-center rounded-2xl ${theme.iconWrap}`}>
          <Icon className="h-4 w-4" />
        </span>
        {title}
      </div>

      <ol className="mt-4 grid gap-3 md:mt-5 md:gap-4">
        {steps.map((step, index) => (
          <li key={index} className="flex items-start gap-3 text-sm leading-6 text-slate-600 md:leading-7">
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
    <article className={`flex h-full flex-col rounded-[24px] bg-white p-4 shadow-sm ring-1 md:rounded-[28px] md:p-5 ${t.ring}`}>
      <div className={`mb-4 inline-flex h-10 w-10 items-center justify-center rounded-full ${t.icon}`}>
        <Quote className="h-4 w-4" />
      </div>
      <p className="text-sm leading-7 text-slate-600">{quote}</p>
      <p className={`mt-5 text-xs font-black uppercase tracking-[0.12em] ${t.author}`}>{author}</p>
    </article>
  );
}


type HomeSlideTone = "emerald" | "violet" | "amber" | "sky" | "slate";

type HomeSlide = {
  key: string;
  label: string;
  eyebrow: string;
  title: string;
  accent: string;
  description: string;
  imageSrc: string;
  imageAlt: string;
  href: string;
  cta: string;
  icon: LucideIcon;
  tone: HomeSlideTone;
  badges: string[];
  metrics: { label: string; value: string; hint: string }[];
};

const homeSlides: HomeSlide[] = [
  {
    key: "absences",
    label: "Cahier des absences",
    eyebrow: "Assiduité en temps réel",
    title: "Les présences et absences",
    accent: "sont suivies dès l’appel.",
    description:
      "L’appel est digitalisé, les retards et absences sont enregistrés immédiatement, puis les parents et la direction disposent d’une information claire.",
    imageSrc: "/accueil.png",
    imageAlt: "Cahier des absences Mon Cahier avec suivi des élèves en classe",
    href: "/parents/login",
    cta: "Voir les absences",
    icon: Clock,
    tone: "emerald",
    badges: ["Appel digital", "Retards", "Notifications"],
    metrics: [
      { label: "Assiduité", value: "94,2%", hint: "taux de présence" },
      { label: "Alertes", value: "Instantané", hint: "absence ou retard" },
      { label: "Suivi", value: "Par classe", hint: "élèves et enseignants" },
    ],
  },
  {
    key: "notes",
    label: "Notes & Évaluations",
    eyebrow: "Résultats scolaires",
    title: "Les notes, moyennes et bulletins",
    accent: "sont centralisés par période.",
    description:
      "Les enseignants saisissent les évaluations, l’administration suit les moyennes et les parents consultent les résultats publiés.",
    imageSrc: "/home/hero-notes.png",
    imageAlt: "Cahier de notes Mon Cahier avec moyennes, matières et bulletin scolaire",
    href: "/parents/login",
    cta: "Voir les notes",
    icon: FileSpreadsheet,
    tone: "amber",
    badges: ["Notes", "Moyennes", "Bulletins"],
    metrics: [
      { label: "Moyenne", value: "14,2/20", hint: "exemple de classe" },
      { label: "Bulletin", value: "Disponible", hint: "après publication" },
      { label: "Exports", value: "PDF", hint: "listes et bilans" },
    ],
  },
  {
    key: "textes",
    label: "Cahier de textes",
    eyebrow: "Suivi pédagogique",
    title: "Les leçons, devoirs et progressions",
    accent: "restent accessibles à tout moment.",
    description:
      "Le professeur renseigne les séances, devoirs et ressources ; la direction suit l’avancement du programme et les familles restent informées.",
    imageSrc: "/home/hero-textes.png",
    imageAlt: "Cahier de textes numérique Mon Cahier avec professeur, tablette et progression pédagogique",
    href: "/login?space=enseignant",
    cta: "Voir le cahier de textes",
    icon: ReceiptText,
    tone: "violet",
    badges: ["Leçons", "Devoirs", "Progression"],
    metrics: [
      { label: "Leçon", value: "Publiée", hint: "séance du jour" },
      { label: "Devoirs", value: "À rendre", hint: "dates visibles" },
      { label: "Programme", value: "72%", hint: "progression suivie" },
    ],
  },
  {
    key: "communication",
    label: "Communication parents-école",
    eyebrow: "Messages et annonces",
    title: "Les parents reçoivent les informations",
    accent: "sans attendre le papier.",
    description:
      "Les annonces, rappels et notifications importantes circulent plus vite entre l’école, les familles et les responsables d’élèves.",
    imageSrc: "/home/hero-communication.png",
    imageAlt: "Communication parents école Mon Cahier avec messages et notifications",
    href: "/parents/login",
    cta: "Voir les messages",
    icon: MessageSquare,
    tone: "sky",
    badges: ["Messages", "Annonces", "Parents"],
    metrics: [
      { label: "Canal", value: "Direct", hint: "école vers parent" },
      { label: "Suivi", value: "Historique", hint: "messages envoyés" },
      { label: "Infos", value: "Claires", hint: "annonces et rappels" },
    ],
  },
  {
    key: "finance",
    label: "Finance scolaire",
    eyebrow: "Paiements et reçus",
    title: "La scolarité, l’internat et les dépenses",
    accent: "sont suivis avec précision.",
    description:
      "La finance scolaire couvre les frais, paiements, reçus, soldes, rapports, dépenses et vues consolidées pour la direction ou le fondateur.",
    imageSrc: "/home/hero-finance.png",
    imageAlt: "Finance scolaire Mon Cahier avec paiements, reçus et suivi des frais",
    href: "/login?space=finance",
    cta: "Voir la finance",
    icon: Wallet,
    tone: "emerald",
    badges: ["Paiements", "Reçus", "Rapports"],
    metrics: [
      { label: "Paiements", value: "Suivis", hint: "par élève et période" },
      { label: "Reçus", value: "Imprimables", hint: "historique disponible" },
      { label: "Budget", value: "Contrôlé", hint: "dépenses et soldes" },
    ],
  },
];

const slideToneClasses: Record<
  HomeSlideTone,
  {
    accent: string;
    button: string;
    soft: string;
    ring: string;
    icon: string;
    glow: string;
    progress: string;
    fallback: string;
  }
> = {
  emerald: {
    accent: "text-emerald-600",
    button: "bg-emerald-600 text-white hover:bg-emerald-700",
    soft: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    ring: "border-emerald-200 bg-emerald-50/70",
    icon: "bg-emerald-100 text-emerald-700",
    glow: "bg-emerald-400/20",
    progress: "bg-emerald-600",
    fallback: "from-emerald-50 via-white to-emerald-100 text-emerald-700",
  },
  violet: {
    accent: "text-violet-600",
    button: "bg-violet-600 text-white hover:bg-violet-700",
    soft: "bg-violet-50 text-violet-700 ring-violet-200",
    ring: "border-violet-200 bg-violet-50/70",
    icon: "bg-violet-100 text-violet-700",
    glow: "bg-violet-400/20",
    progress: "bg-violet-600",
    fallback: "from-violet-50 via-white to-violet-100 text-violet-700",
  },
  amber: {
    accent: "text-amber-600",
    button: "bg-amber-500 text-white hover:bg-amber-600",
    soft: "bg-amber-50 text-amber-700 ring-amber-200",
    ring: "border-amber-200 bg-amber-50/70",
    icon: "bg-amber-100 text-amber-700",
    glow: "bg-amber-400/20",
    progress: "bg-amber-500",
    fallback: "from-amber-50 via-white to-amber-100 text-amber-700",
  },
  sky: {
    accent: "text-sky-600",
    button: "bg-sky-600 text-white hover:bg-sky-700",
    soft: "bg-sky-50 text-sky-700 ring-sky-200",
    ring: "border-sky-200 bg-sky-50/70",
    icon: "bg-sky-100 text-sky-700",
    glow: "bg-sky-400/20",
    progress: "bg-sky-600",
    fallback: "from-sky-50 via-white to-sky-100 text-sky-700",
  },
  slate: {
    accent: "text-slate-700",
    button: "bg-slate-900 text-white hover:bg-slate-800",
    soft: "bg-slate-100 text-slate-700 ring-slate-200",
    ring: "border-slate-200 bg-slate-50/80",
    icon: "bg-slate-100 text-slate-700",
    glow: "bg-slate-300/25",
    progress: "bg-slate-900",
    fallback: "from-slate-50 via-white to-slate-100 text-slate-700",
  },
};

function SmartHomeImage({
  slide,
  priority = false,
  className = "",
}: {
  slide: HomeSlide;
  priority?: boolean;
  className?: string;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const tone = slideToneClasses[slide.tone];
  const Icon = slide.icon;

  useEffect(() => {
    setImageFailed(false);
  }, [slide.imageSrc]);

  if (imageFailed) {
    return (
      <div className={`flex h-full w-full items-center justify-center bg-gradient-to-br ${tone.fallback} ${className}`}>
        <div className="text-center">
          <div className={`mx-auto grid h-16 w-16 place-items-center rounded-3xl ${tone.icon}`}>
            <Icon className="h-8 w-8" />
          </div>
          <div className="mt-4 text-sm font-black uppercase tracking-[0.16em]">{slide.label}</div>
          <div className="mx-auto mt-2 max-w-xs text-sm leading-6 text-slate-600">{slide.eyebrow}</div>
        </div>
      </div>
    );
  }

  return (
    <Image
      key={slide.imageSrc}
      src={slide.imageSrc}
      alt={slide.imageAlt}
      fill
      priority={priority}
      sizes="(min-width: 1024px) 58vw, 100vw"
      className={`object-cover ${className}`}
      onError={() => setImageFailed(true)}
    />
  );
}

function HeroSlider({
  activeIndex,
  onSelect,
  onNext,
  onPrevious,
}: {
  activeIndex: number;
  onSelect: (index: number) => void;
  onNext: () => void;
  onPrevious: () => void;
}) {
  const slide = homeSlides[activeIndex];
  const tone = slideToneClasses[slide.tone];
  const Icon = slide.icon;

  return (
    <div className="relative overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-xl md:rounded-[36px]">
      <div className={`pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full blur-3xl ${tone.glow}`} />
      <div className="grid min-h-[560px] grid-cols-1 lg:grid-cols-[0.9fr_1.15fr]">
        <div className="relative z-10 flex flex-col justify-center px-5 py-7 sm:px-8 md:px-10 lg:py-10">
          <div className={`inline-flex w-fit items-center gap-2 rounded-full px-3 py-1 text-xs font-black uppercase tracking-[0.14em] ring-1 ${tone.soft}`}>
            <Icon className="h-4 w-4" />
            {slide.eyebrow}
          </div>

          <h1 className="mt-5 text-[2.4rem] font-black leading-[1.08] tracking-tight text-slate-950 sm:text-5xl xl:text-[3.4rem]">
            {slide.title}
            <span className={`block ${tone.accent}`}>{slide.accent}</span>
          </h1>

          <p className="mt-5 max-w-2xl text-[15px] leading-7 text-slate-600 md:text-base md:leading-8">
            {slide.description}
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            {slide.badges.map((badge) => (
              <span key={badge} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700 ring-1 ring-slate-200">
                {badge}
              </span>
            ))}
          </div>

          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link href={slide.href} className={`inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-black shadow-sm ${tone.button}`}>
              {slide.cta}
              <ArrowRight className="h-4 w-4" />
            </Link>
            <a
              href="#modules"
              className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-black text-slate-800 hover:bg-slate-50"
            >
              Tous les modules
            </a>
          </div>
        </div>

        <div className="relative min-h-[360px] border-t border-slate-200 lg:min-h-full lg:border-l lg:border-t-0">
          <SmartHomeImage slide={slide} priority className="transition duration-700" />

          <div className="absolute inset-x-4 bottom-4 grid gap-2 sm:grid-cols-3 lg:inset-x-6 lg:bottom-6">
            {slide.metrics.map((metric) => (
              <div key={metric.label} className="rounded-2xl border border-white/70 bg-white/95 p-3 shadow-lg backdrop-blur">
                <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{metric.label}</div>
                <div className="mt-1 text-lg font-black text-slate-950">{metric.value}</div>
                <div className="text-xs font-semibold text-slate-500">{metric.hint}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="border-t border-slate-200 bg-slate-950 px-3 py-3 text-white md:px-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {homeSlides.map((item, index) => {
              const itemTone = slideToneClasses[item.tone];
              const ItemIcon = item.icon;
              const active = index === activeIndex;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => onSelect(index)}
                  className={`group flex items-center gap-2 rounded-2xl px-3 py-2 text-left text-xs font-black transition ${
                    active ? "bg-white text-slate-950 shadow-sm" : "bg-white/5 text-slate-200 hover:bg-white/10"
                  }`}
                >
                  <span className={`grid h-8 w-8 flex-none place-items-center rounded-xl ${active ? itemTone.icon : "bg-white/10 text-white"}`}>
                    <ItemIcon className="h-4 w-4" />
                  </span>
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-3 lg:justify-end">
            <button
              type="button"
              onClick={onPrevious}
              className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white ring-1 ring-white/15 hover:bg-white/20"
              aria-label="Module précédent"
            >
              <ArrowRight className="h-4 w-4 rotate-180" />
            </button>
            <div className="flex items-center gap-1.5">
              {homeSlides.map((item, index) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => onSelect(index)}
                  className={`h-2 rounded-full transition ${index === activeIndex ? `w-8 ${tone.progress}` : "w-2 bg-white/40"}`}
                  aria-label={`Afficher ${item.label}`}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={onNext}
              className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white ring-1 ring-white/15 hover:bg-white/20"
              aria-label="Module suivant"
            >
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function HomeModuleCards({ activeIndex, onSelect }: { activeIndex: number; onSelect: (index: number) => void }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
      {homeSlides.map((slide, index) => {
        const tone = slideToneClasses[slide.tone];
        const Icon = slide.icon;
        const active = activeIndex === index;

        return (
          <button
            key={slide.key}
            type="button"
            onClick={() => onSelect(index)}
            className={`group overflow-hidden rounded-[24px] border bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md md:rounded-[28px] ${
              active ? tone.ring : "border-slate-200"
            }`}
          >
            <div className="relative h-32 overflow-hidden bg-slate-100">
              <SmartHomeImage slide={slide} className="transition duration-500 group-hover:scale-[1.03]" />
              <div className="absolute left-3 top-3 grid h-10 w-10 place-items-center rounded-2xl bg-white/90 text-slate-900 shadow-sm backdrop-blur">
                <Icon className="h-5 w-5" />
              </div>
            </div>
            <div className="p-4">
              <h3 className="text-sm font-black text-slate-950 md:text-[15px]">{slide.label}</h3>
              <p className="mt-2 line-clamp-3 text-sm leading-6 text-slate-600">{slide.description}</p>
              <div className={`mt-3 inline-flex items-center gap-1 text-xs font-black ${tone.accent}`}>
                Découvrir
                <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

export default function HomePage() {
  const { session } = useAuth();
  const router = useRouter();
  const redirectedRef = useRef(false);
  const [activeHeroIndex, setActiveHeroIndex] = useState(0);

  const selectHeroSlide = (index: number) => {
    setActiveHeroIndex(index);
  };

  const showNextHeroSlide = () => {
    setActiveHeroIndex((current) => (current + 1) % homeSlides.length);
  };

  const showPreviousHeroSlide = () => {
    setActiveHeroIndex((current) => (current - 1 + homeSlides.length) % homeSlides.length);
  };

  useEffect(() => {
    if (session && !redirectedRef.current) {
      redirectedRef.current = true;
      router.replace("/redirect");
    }
  }, [session, router]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActiveHeroIndex((current) => (current + 1) % homeSlides.length);
    }, 6500);

    return () => window.clearInterval(timer);
  }, []);

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
          <li>Cahier de textes : leçons, devoirs, ressources et progression pédagogique.</li>
          <li>Communication parents-école : annonces, messages et notifications.</li>
          <li>Gestion financière : inscriptions, scolarité, paiements, reçus, dépenses et paie.</li>
          <li>Infirmerie scolaire : billet justificatif, notification parent et suivi des repos.</li>
          <li>Espace parent, enseignant, direction, infirmerie, finance, fondateur et supervision.</li>
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

      <header className="sticky top-0 z-30 w-full border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-2 md:gap-4 md:py-3">
          <a href="#hero" className="flex min-w-0 shrink items-center gap-2 md:gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 md:h-11 md:w-11">
              <Shield className="h-5 w-5" />
            </div>

            <div className="min-w-0 text-slate-900">
              <div className="truncate text-sm font-black tracking-wide">Mon Cahier</div>
              <div className="hidden text-xs text-slate-500 sm:block">École, finances &amp; pilotage en temps réel</div>
            </div>
          </a>

          <nav className="hidden items-center gap-4 text-sm font-bold text-slate-700 lg:flex">
            <a href="#spaces" className="hover:text-emerald-700">Espaces</a>
            <a href="#modules" className="hover:text-emerald-700">Modules</a>
            <a href="#finance" className="hover:text-emerald-700">Finance</a>
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
            className="inline-flex shrink-0 items-center gap-2 rounded-full bg-slate-900 px-3 py-2 text-xs font-black text-white shadow-sm hover:bg-slate-800 sm:px-4 sm:text-sm xl:hidden"
          >
            <span className="sm:hidden">Connexion</span>
            <span className="hidden sm:inline">Se connecter</span>
          </a>
        </div>
      </header>

      <section className="border-b border-slate-200 bg-slate-900 text-slate-100">
        <div className="mx-auto max-w-7xl px-4 py-2.5 text-center text-xs font-semibold leading-5 tracking-wide md:py-3 md:text-sm">
          Mon Cahier réunit assiduité, notes, finances, bulletins, supervision et prédiction scolaire.
        </div>
      </section>

      <section id="hero" className="px-4 pb-5 pt-4 md:pb-8 md:pt-8">
        <div className="mx-auto max-w-7xl">
          <HeroSlider
            activeIndex={activeHeroIndex}
            onSelect={selectHeroSlide}
            onNext={showNextHeroSlide}
            onPrevious={showPreviousHeroSlide}
          />
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-5 md:pb-6">
        <HomeModuleCards activeIndex={activeHeroIndex} onSelect={selectHeroSlide} />
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-5 md:pb-6">
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
          description="La page d’accueil présente maintenant les accès réellement disponibles : parent, enseignant, direction, infirmerie, finance et fondateur."
        />

        <div className="mt-5 grid gap-4 md:mt-6 md:grid-cols-2 xl:grid-cols-6">
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
            href="/login?space=infirmerie"
            icon={HeartPulse}
            title="Infirmerie"
            description="Enregistrer les passages, notifier les parents et imprimer les billets justificatifs."
            badge="Santé"
            tone="emerald"
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
          title="Tous les services essentiels de l’école réunis au même endroit"
          description="La plateforme couvre l’assiduité, les notes, les bulletins, les finances, la communication avec les parents et le pilotage administratif."
        />

        <div className="mt-5 grid grid-cols-1 gap-4 md:mt-6 md:grid-cols-2 xl:grid-cols-3">
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
            icon={ReceiptText}
            title="Cahier de textes numérique"
            desc="Séances, leçons, devoirs, ressources pédagogiques et progression du programme accessibles par classe."
            tone="violet"
          />
          <FeatureCard
            icon={MessageSquare}
            title="Communication parents-école"
            desc="Annonces, messages, alertes et informations importantes transmises rapidement aux familles."
            tone="slate"
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

      <section id="finance" className="mx-auto max-w-7xl px-4 py-6 md:py-8">
        <div className="overflow-hidden rounded-[26px] border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-slate-50 p-5 shadow-sm md:rounded-[32px] md:p-7">
          <SectionTitle
            eyebrow="Gestion financière"
            title="Un suivi clair des frais, paiements et dépenses de l’établissement"
            description="Mon Cahier aide la direction et le gestionnaire financier à suivre les encaissements, les soldes, les reçus, les dépenses et les rapports sans mélanger la finance avec les autres rôles."
          />

          <div className="mt-5 grid grid-cols-1 gap-4 md:mt-6 md:grid-cols-2 xl:grid-cols-4">
            <FeatureCard
              icon={Wallet}
              title="Frais et scolarité"
              desc="Paramétrage des frais par année, classe, catégorie, statut affecté ou non affecté, internat et rubriques spécifiques."
              tone="amber"
            />
            <FeatureCard
              icon={ReceiptText}
              title="Paiements et reçus"
              desc="Enregistrement des paiements, reçus imprimables, historique des versements et suivi des encaissements par période."
              tone="amber"
            />
            <FeatureCard
              icon={Landmark}
              title="Dépenses et rapports"
              desc="Suivi des sorties, états financiers, totaux encaissés, ventilation par catégorie et aide à la décision pour la direction."
              tone="slate"
            />
            <FeatureCard
              icon={UserCog}
              title="Espace finance séparé"
              desc="Le gestionnaire financier travaille dans son propre espace, tandis que le fondateur garde une vue consolidée des établissements."
              tone="violet"
            />
          </div>

          <div className="mt-5 grid gap-4 rounded-[24px] border border-amber-200 bg-white/80 p-4 md:mt-6 md:grid-cols-3 md:p-5">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.16em] text-amber-700">Encaissements</div>
              <p className="mt-2 text-sm leading-6 text-slate-600">Voir ce qui est payé, restant dû, encaissé par période et par catégorie.</p>
            </div>
            <div>
              <div className="text-xs font-black uppercase tracking-[0.16em] text-amber-700">Parents</div>
              <p className="mt-2 text-sm leading-6 text-slate-600">Donner une information financière plus claire aux familles, avec reçus et historiques.</p>
            </div>
            <div>
              <div className="text-xs font-black uppercase tracking-[0.16em] text-amber-700">Fondateur</div>
              <p className="mt-2 text-sm leading-6 text-slate-600">Suivre l’activité financière globale sans exposer les écrans sensibles aux mauvais profils.</p>
            </div>
          </div>
        </div>
      </section>

      <section id="steps" className="mx-auto max-w-7xl px-4 py-6 md:py-8">
        <SectionTitle
          eyebrow="Déploiement"
          title="Une organisation claire dès le départ"
          description="L’établissement paramètre ses données, puis chaque profil travaille uniquement dans son périmètre."
        />

        <div className="mt-5 grid grid-cols-1 gap-4 md:mt-6 md:grid-cols-2 md:gap-6">
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

        <div className="mt-5 grid gap-4 md:mt-6 md:grid-cols-3">
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
            <div className="mt-5 md:mt-6">
              <Accordion items={subscribeFaq} />
            </div>
          </div>

          <div>
            <SectionTitle eyebrow="FAQ" title="Connexions" />
            <div className="mt-5 md:mt-6">
              <Accordion items={manageFaq} />
            </div>
          </div>
        </div>
      </section>

      <section id="contact" className="mx-auto max-w-7xl px-4 pb-20 pt-6 md:pt-8">
        <div className="relative overflow-hidden rounded-[26px] border border-slate-200 bg-gradient-to-r from-slate-950 via-slate-900 to-emerald-950 p-5 text-white shadow-xl md:rounded-[32px] md:p-8">
          <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
            <div className="max-w-3xl">
              <div className="text-xs font-black uppercase tracking-[0.18em] text-emerald-300">Contact</div>
              <h3 className="mt-3 text-2xl font-black leading-tight tracking-tight md:text-3xl">Présenter Mon Cahier à votre établissement</h3>
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

      <footer className="bg-slate-900 py-10 text-slate-100 md:py-12">
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
              <li><a href="#finance" className="hover:text-white">Gestion financière</a></li>
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
        className="fixed bottom-6 right-6 hidden h-12 w-12 place-items-center rounded-full bg-slate-900 text-white shadow-lg ring-1 ring-slate-300 transition hover:bg-slate-800 sm:grid"
        aria-label="Revenir en haut"
      >
        <ArrowUp className="h-5 w-5" />
      </a>
    </main>
  );
}

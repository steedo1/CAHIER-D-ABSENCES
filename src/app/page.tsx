"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./providers";
import {
  Bell,
  Check,
  Clock,
  FileSpreadsheet,
  Rocket,
  Shield,
  Users,
  Building2,
  MessageSquare,
  PhoneCall,
  ArrowUp,
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
    "https://wa.me/2250720672094?text=Bonjour%20Mon%20Cahier%20d%E2%80%99Absences%2C%20je%20souhaite%20m%E2%80%99abonner.";
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <a
        href={wa}
        target="_blank"
        rel="noreferrer"
        className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-sm font-semibold text-white shadow hover:bg-indigo-700"
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

/* ───────────────────────── Fancy helpers (no deps) ───────────────────────── */
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
    const max = 6; // deg
    el.style.transform = `perspective(900px) rotateX(${rx * max}deg) rotateY(${ry * max}deg) translateZ(0)`;
  }
  function handleLeave() {
    const el = ref.current;
    if (!el) return;
    el.style.transform = "perspective(900px) rotateX(0deg) rotateY(0deg) translateZ(0)";
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

function Stat({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-600/10 text-indigo-700">
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
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
    <TiltCard className="rounded-2xl border border-slate-200 bg-white/90 p-5 shadow-sm hover:shadow-md">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-indigo-600 text-white shadow-sm">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className="text-base font-semibold text-slate-900">{title}</div>
          <p className="mt-1 text-sm leading-6 text-slate-700">{desc}</p>
        </div>
      </div>
    </TiltCard>
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
            Rôles clairs : super admin, admin d’établissement, enseignant, parent — <b>une seule vue par rôle</b>.
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
          Dans <b>Paramètres → Abonnement</b>, vous voyez l’échéance et l’historique des paiements.
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
      {/* Gradient/Aurora background (non intrusif) */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute left-[5%] top-[-8%] h-80 w-80 rounded-full bg-fuchsia-300/40 blur-2xl md:h-[28rem] md:w-[28rem]" />
        <div className="absolute right-[2%] top-[10%] h-72 w-72 rounded-full bg-indigo-300/40 blur-2xl md:h-[26rem] md:w-[26rem]" />
        <div className="absolute bottom-[-10%] left-[15%] h-72 w-72 rounded-full bg-emerald-300/40 blur-2xl md:h-[26rem] md:w-[26rem]" />
      </div>

      {/* Header */}
      <header className="sticky top-0 z-30 w-full bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 text-white shadow-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <a href="#hero" className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-white/15 text-white shadow-sm">
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
            <div className="text-white">
              <div className="text-sm font-semibold tracking-wide">Mon Cahier d’Absences</div>
              <div className="text-xs text-white/80">Portail Parents & Établissements</div>
            </div>
          </a>

          <nav className="hidden items-center gap-6 text-sm font-semibold text-white/80 md:flex">
            <a href="#features" className="hover:text-white">Fonctionnalités</a>
            <a href="#steps" className="hover:text-white">Comment ça marche</a>
            <a href="#faq" className="hover:text-white">FAQ</a>
            <a href="#contact" className="hover:text-white">Contact</a>
          </nav>

          <div className="flex items-center gap-2">
            <a
              href="/parents/login"
              className="rounded-full bg-emerald-600 px-3.5 py-1.5 text-sm font-semibold text-white shadow ring-1 ring-white/20 hover:bg-emerald-700"
            >
              Espace parent
            </a>
            <a
              href="/login"
              className="rounded-full bg-indigo-600 px-3.5 py-1.5 text-sm font-semibold text-white shadow ring-1 ring-white/20 hover:bg-indigo-700"
            >
              Espace établissement
            </a>
          </div>
        </div>
      </header>

      {/* HERO */}
      <section id="hero" className="relative overflow-hidden">
        <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-10 px-4 py-12 md:grid-cols-2 md:py-20">
          <div className="relative z-10">
            <Pill>
              <Rocket className="h-3.5 w-3.5" />
              <span>L’appel le plus rapide pour vos classes</span>
            </Pill>
            <h1 className="mt-4 text-4xl font-extrabold leading-tight text-slate-900 md:text-6xl">
              Le cahier d’absences <span className="text-indigo-600">numérique</span>
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-slate-700">
              Appel ultra-rapide, alertes parents instantanées, suivi des heures,
              exports CSV, et tableaux de bord clairs pour toute l’équipe.
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-3">
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
              <a
                href="#contact"
                className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-800 ring-1 ring-slate-200 hover:bg-slate-50"
              >
                Nous contacter
              </a>
            </div>

            <div className="mt-8 grid max-w-2xl grid-cols-2 gap-3">
              <Stat icon={Users} label="Parents touchés" value="> 10 000" />
              <Stat icon={Clock} label="Temps d’appel moyen" value="< 60 s" />
              <Stat icon={Bell} label="Notifications envoyées" value="> 250 000" />
              <Stat icon={Shield} label="Rôles & accès" value="Sécurisés" />
            </div>
          </div>

          <div className="relative">
            <div className="pointer-events-none absolute right-0 top-0 h-full w-14 bg-yellow-300/70 md:w-20" />
            <TiltCard className="relative overflow-hidden rounded-l-[44px] border border-slate-200 shadow-xl">
              <Image
                src="/accueil.png"
                alt="Parents et enseignants suivent l’assiduité"
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
      <section id="steps" className="mx-auto max-w-7xl px-4 pb-8 md:pb-12">
        <SectionTitle>Comment ça marche</SectionTitle>
        <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-6">
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-indigo-700">
              <Building2 className="h-4 w-4" /> Établissement
            </div>
            <ol className="grid gap-3 text-sm text-slate-700">
              <li className="flex items-start gap-3"><span className="mt-1 inline-grid h-6 w-6 flex-none place-items-center rounded-full bg-indigo-600 text-white">1</span> Créez vos classes et comptes enseignants (import CSV possible).</li>
              <li className="flex items-start gap-3"><span className="mt-1 inline-grid h-6 w-6 flex-none place-items-center rounded-full bg-indigo-600 text-white">2</span> Affectez vos disciplines aux professeurs en un clic.</li>
              <li className="flex items-start gap-3"><span className="mt-1 inline-grid h-6 w-6 flex-none place-items-center rounded-full bg-indigo-600 text-white">3</span> Lancez l’appel en cours : absences/retards sont notifiés aux parents.</li>
            </ol>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-6">
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-emerald-700">
              <Users className="h-4 w-4" /> Parent
            </div>
            <ol className="grid gap-3 text-sm text-slate-700">
              <li className="flex items-start gap-3"><span className="mt-1 inline-grid h-6 w-6 flex-none place-items-center rounded-full bg-emerald-600 text-white">1</span> Connectez-vous à l’Espace parent.</li>
              <li className="flex items-start gap-3"><span className="mt-1 inline-grid h-6 w-6 flex-none place-items-center rounded-full bg-emerald-600 text-white">2</span> Associez votre enfant via son matricule (si requis par l’établissement).</li>
              <li className="flex items-start gap-3"><span className="mt-1 inline-grid h-6 w-6 flex-none place-items-center rounded-full bg-emerald-600 text-white">3</span> Recevez les alertes d’absence/retard et suivez l’historique.</li>
            </ol>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-7xl px-4 pb-10 md:pb-16">
        <SectionTitle>Fonctionnalités clés</SectionTitle>
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          <FeatureCard icon={Clock} title="Appel ultra-rapide"
            desc="Démarrez un créneau en 1 clic et notez absences/retards en quelques secondes." />
          <FeatureCard icon={Bell} title="Notifications instantanées"
            desc="Les parents sont alertés en temps réel après validation de l’appel." />
          <FeatureCard icon={FileSpreadsheet} title="Exports CSV propres"
            desc="Récupérez vos données (absences, retards, heures) dans des CSV lisibles." />
          <FeatureCard icon={Shield} title="Rôles & RLS"
            desc="Accès sécurisés et vues dédiées : super admin, admin, enseignant, parent." />
          <FeatureCard icon={Users} title="Parents connectés"
            desc="Associez les responsables aux élèves et centralisez la communication." />
          <FeatureCard icon={Rocket} title="Prêt pour l’échelle"
            desc="Pensé pour des milliers d’élèves et des dizaines d’établissements." />
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
        <div className="relative overflow-hidden rounded-3xl border border-indigo-200 bg-linear-to-r from-indigo-600 via-violet-600 to-fuchsia-600 p-0.5 shadow-xl">
          <div className="rounded-[calc(1.5rem-2px)] bg-white p-6 md:p-10">
            <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
              <div>
                <h3 className="text-2xl font-extrabold text-slate-900 md:text-3xl">
                  Parlons de votre établissement
                </h3>
                <p className="mt-1 max-w-2xl text-sm text-slate-700">
                  On s’occupe de la mise en route. Vous gardez la main ensuite : classes, enseignants,
                  matières, exports… le tout en autonomie.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <a
                  href="https://wa.me/2250720672094?text=Bonjour%20Mon%20Cahier%20d%E2%80%99Absences%2C%20je%20souhaite%20m%E2%80%99abonner."
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
      <footer className="bg-indigo-950 py-12 text-indigo-50">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-10 px-4 md:grid-cols-3">
          <div>
            <div className="text-2xl font-extrabold">Mon Cahier d’Absences</div>
            <div className="mt-1 text-indigo-300">Copyrights © {new Date().getFullYear()}</div>
          </div>
          <div>
            <h3 className="text-lg font-semibold">Pour commencer</h3>
            <ul className="mt-3 space-y-2 text-indigo-200">
              <li><a href="#features" className="hover:text-white">Fonctionnalités</a></li>
              <li><a href="#steps" className="hover:text-white">Comment ça marche</a></li>
              <li><a href="#faq" className="hover:text-white">FAQ</a></li>
              <li><a href="#contact" className="hover:text-white">Contact</a></li>
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
        className="fixed bottom-6 right-6 grid h-12 w-12 place-items-center rounded-full bg-indigo-600 text-white shadow-lg ring-1 ring-indigo-300 transition hover:bg-indigo-700"
        aria-label="Revenir en haut"
      >
        <ArrowUp className="h-5 w-5" />
      </a>
    </main>
  );
}

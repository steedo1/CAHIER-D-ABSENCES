"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  CalendarDays,
  FileSpreadsheet,
  School,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

type MontageStep = {
  href: string;
  label: string;
  description: string;
  Icon: LucideIcon;
  aliases?: string[];
};

export const MONTAGE_STEPS: MontageStep[] = [
  {
    href: "/admin/montage-emploi-du-temps",
    label: "Vue d’ensemble",
    description: "Tableau de bord du montage",
    Icon: CalendarDays,
  },
  {
    href: "/admin/montage-emploi-du-temps/volumes",
    label: "Référentiels et services",
    description: "Matières, volumes, créneaux et affectations",
    Icon: FileSpreadsheet,
  },
  {
    href: "/admin/montage-emploi-du-temps/ressources",
    label: "Salles et ressources",
    description: "Salles, terrains, laboratoires et préférences",
    Icon: School,
  },
  {
    href: "/admin/montage-emploi-du-temps/indisponibilites",
    label: "Indisponibilités",
    description: "Contraintes professeurs",
    Icon: Users,
  },
  {
    href: "/admin/montage-emploi-du-temps/regles-terrain",
    label: "Règles terrain",
    description: "Contraintes propres à l’établissement",
    Icon: Settings,
  },
  {
    href: "/admin/montage-emploi-du-temps/generation",
    label: "Services et génération",
    description: "Contrôle final, génération et diagnostics",
    Icon: BarChart3,
    aliases: ["/admin/montage-emploi-du-temps/services", "/admin/montage-emploi-du-temps/projets"],
  },
  {
    href: "/admin/montage-emploi-du-temps/publication",
    label: "Publication",
    description: "Validation et écriture officielle",
    Icon: ShieldCheck,
  },
];

function isStepActive(pathname: string, step: MontageStep) {
  if (step.href === "/admin/montage-emploi-du-temps") return pathname === step.href;
  if (pathname.startsWith(step.href)) return true;
  return Boolean(step.aliases?.some((alias) => pathname.startsWith(alias)));
}

export default function MontageStepNav() {
  const pathname = usePathname() || "";

  return (
    <nav className="rounded-[28px] border border-slate-200 bg-white p-3 shadow-sm" aria-label="Étapes du montage emploi du temps">
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-7">
        {MONTAGE_STEPS.map((step, index) => {
          const active = isStepActive(pathname, step);
          const Icon = step.Icon;

          return (
            <Link
              key={step.href}
              href={step.href}
              className={active
                ? "group rounded-2xl bg-slate-950 px-3 py-3 text-white shadow-sm transition"
                : "group rounded-2xl px-3 py-3 text-slate-700 transition hover:bg-slate-50 hover:text-slate-950"}
            >
              <div className="flex items-center gap-2">
                <span className={active
                  ? "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/12 text-white ring-1 ring-white/15"
                  : "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700 ring-1 ring-slate-200 group-hover:bg-white"}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className={active ? "text-[11px] font-black uppercase tracking-wide text-slate-300" : "text-[11px] font-black uppercase tracking-wide text-slate-400"}>
                  {String(index + 1).padStart(2, "0")}
                </span>
              </div>
              <p className="mt-2 text-sm font-black leading-5">{step.label}</p>
              <p className={active ? "mt-1 text-xs leading-5 text-slate-300" : "mt-1 text-xs leading-5 text-slate-500"}>{step.description}</p>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

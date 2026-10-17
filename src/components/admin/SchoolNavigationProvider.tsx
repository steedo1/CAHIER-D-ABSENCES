"use client";
import { normalizeSchoolLevel, sameSchoolLevel } from "@/lib/school-levels";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { SCHOOL_CYCLE_OPTIONS, TEACHING_TRACK_OPTIONS, getSchoolAdminNavigation, type SchoolCyclesSettings } from "@/lib/school-cycles";
import { readSchoolNavigation, resolveSchoolNavigation, SCHOOL_CONTEXT_KEYS, withSchoolNavigation, type SchoolNavigationClass, type SchoolNavigationContext } from "@/lib/school-navigation";

type NavigationValue = {
  settings: SchoolCyclesSettings;
  selection: SchoolNavigationContext;
  classes: SchoolNavigationClass[];
  change: (patch: Partial<SchoolNavigationContext>) => void;
  href: (href: string) => string;
  error: string;
};
const Context = createContext<NavigationValue | null>(null);
export const useSchoolNavigation = () => useContext(Context);

export function SchoolNavigationProvider({ settings, children }: { settings: SchoolCyclesSettings; children: ReactNode }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [classes, setClasses] = useState<SchoolNavigationClass[]>([]);
  const [error, setError] = useState("");
  const lastSelection = useRef<Partial<SchoolNavigationContext>>({});
  useEffect(() => {
    if (!settings.enabled || !navigator.onLine) return;
    const controller = new AbortController();
    let alive = true;
    void fetch("/api/admin/school-cycles?view=navigation", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error("Les classes ne sont pas disponibles.");
        if (alive) { setClasses(data.classes || []); setError(""); }
      }).catch(() => { if (alive) setError("Les niveaux et classes sont momentanément indisponibles."); });
    return () => { alive = false; controller.abort(); };
  }, [settings.enabled]);
  const hasContext = SCHOOL_CONTEXT_KEYS.some(key => params.has(key)) || params.has("cycle");
  const requested = hasContext ? readSchoolNavigation(params) : lastSelection.current;
  const selection = resolveSchoolNavigation(settings, requested, classes);
  // Keep a validated level/class in the URL until the navigation catalog loads.
  // The selector itself never displays unverified IDs as authorized classes.
  const linkSelection = { ...selection,
    ...(!classes.length ? { level: requested.level || "", classId: requested.classId || "" } : {}),
  };
  useEffect(() => {
    lastSelection.current = linkSelection;
  });
  const value: NavigationValue = {
    settings, selection, classes, error,
    href: href => settings.enabled ? withSchoolNavigation(href, linkSelection) : href,
    change(patch) {
      const next = resolveSchoolNavigation(settings, { ...selection, ...patch }, classes);
      const query = new URLSearchParams(params.toString());
      for (const key of SCHOOL_CONTEXT_KEYS) query.delete(key);
      query.delete("cycle");
      router.replace(withSchoolNavigation(`${pathname}${query.size ? `?${query}` : ""}`, next), { scroll: false });
    },
  };
  return <Context.Provider value={settings.enabled ? value : null}>{children}</Context.Provider>;
}

export function SchoolContextLink(props: ComponentProps<typeof Link>) {
  const navigation = useSchoolNavigation();
  const href = typeof props.href === "string" && navigation ? navigation.href(props.href) : props.href;
  return <Link {...props} href={href} />;
}

export function SchoolNavigationBar() {
  const context = useSchoolNavigation();
  const levels = useMemo(() => context ? Array.from(new Set(context.classes
    .filter(row => context.selection.cycle === "all" || row.cycle === context.selection.cycle)
    .map(row => normalizeSchoolLevel(row.level, row.cycle)).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, "fr", { numeric: true })) : [], [context]);
  if (!context) return null;
  const { settings, selection, classes, change } = context;
  const options = getSchoolAdminNavigation(settings, selection.cycle);
  const shownClasses = classes.filter(row => (selection.cycle === "all" || row.cycle === selection.cycle) && (!selection.level || sameSchoolLevel(row.level, selection.level, row.cycle)));
  const field = "mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm";
  return <nav aria-label="Contexte pédagogique" className="mb-5 rounded-2xl border bg-white p-4 shadow-sm">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <label className="text-xs font-semibold">Cycle
        <select className={field} value={selection.cycle} onChange={event => change({ cycle: event.target.value as SchoolNavigationContext["cycle"], level: "", classId: "" })}>
          {options.showCycleSelector && <option value="all">Toute l’école</option>}
          {options.availableCycles.map(cycle => <option key={cycle} value={cycle}>{SCHOOL_CYCLE_OPTIONS.find(item => item.id === cycle)?.label}</option>)}
        </select>
      </label>
      <label className="text-xs font-semibold">Enseignement
        <select className={field} value={selection.track} onChange={event => change({ track: event.target.value as SchoolNavigationContext["track"] })}>
          {options.showTrackSelector && <option value="all">Tous les enseignements</option>}
          {options.availableTracks.map(track => <option key={track} value={track}>{TEACHING_TRACK_OPTIONS.find(item => item.id === track)?.label}</option>)}
        </select>
      </label>
      <label className="text-xs font-semibold">Niveau
        <select className={field} value={selection.level} onChange={event => change({ level: event.target.value, classId: "" })}>
          <option value="">Tous les niveaux</option>{levels.map(level => <option key={level}>{level}</option>)}
        </select>
      </label>
      <label className="text-xs font-semibold">Classe administrative
        <select className={field} value={selection.classId} onChange={event => change({ classId: event.target.value })}>
          <option value="">Toutes les classes</option>{shownClasses.map(row => <option key={row.id} value={row.id}>{row.label}</option>)}
        </select>
      </label>
    </div>
    <div className="mt-3 flex flex-wrap gap-4 text-xs font-semibold text-sky-800">
      <SchoolContextLink href="/admin/cycles">Vue des cycles</SchoolContextLink>
      <SchoolContextLink href="/admin/bulletins/modeles">Matières et paramètres des bulletins</SchoolContextLink>
    </div>
    {context.error && <p role="status" className="mt-2 text-xs text-amber-900">{context.error}</p>}
  </nav>;
}

/**
 * Persistent working-context selector in the existing sidebar.
 * This changes only URL/presentation state; school permissions stay server-side.
 * It does not render for schools using the historical engine.
 */
export function SchoolNavigationSidebarSelector() {
  const context = useSchoolNavigation();
  if (!context) return null;

  const { settings, selection, classes, change, error } = context;
  const options = getSchoolAdminNavigation(settings, selection.cycle);
  const levels = Array.from(new Set(classes
    .filter(row => selection.cycle === "all" || row.cycle === selection.cycle)
    .map(row => normalizeSchoolLevel(row.level, row.cycle))
    .filter(Boolean))).sort((a, b) => a.localeCompare(b, "fr", { numeric: true }));
  const availableClasses = classes.filter(row =>
    (selection.cycle === "all" || row.cycle === selection.cycle) &&
    (!selection.level || sameSchoolLevel(row.level, selection.level, row.cycle)),
  );
  const field = "mt-1 w-full min-h-10 rounded-lg border border-white/20 bg-slate-800 px-2 text-sm text-white focus:border-emerald-400";
  return (
    <section aria-label="Espace de travail" className="shrink-0 border-b border-white/10 px-4 pb-4">
      <div className="rounded-xl border border-emerald-400/25 bg-emerald-400/10 p-3">
        <h2 className="text-xs font-bold uppercase tracking-wider text-emerald-200">Espace de travail</h2>
        <label className="mt-3 block text-xs font-semibold text-slate-200">
          Enseignement
          <select className={field} value={selection.track}
            onChange={event => change({ track: event.target.value as SchoolNavigationContext["track"], classId: "" })}>
            {options.showTrackSelector && <option value="all">Toute l’école</option>}
            {options.availableTracks.map(track =>
              <option key={track} value={track}>{TEACHING_TRACK_OPTIONS.find(item => item.id === track)?.label || track}</option>)}
          </select>
        </label>
        <label className="mt-3 block text-xs font-semibold text-slate-200">
          Cycle
          <select className={field} value={selection.cycle}
            onChange={event => change({ cycle: event.target.value as SchoolNavigationContext["cycle"], level: "", classId: "" })}>
            {options.showCycleSelector && <option value="all">Tous les cycles</option>}
            {options.availableCycles.map(cycle =>
              <option key={cycle} value={cycle}>{SCHOOL_CYCLE_OPTIONS.find(item => item.id === cycle)?.label || cycle}</option>)}
          </select>
        </label>
        <details className="mt-3 text-xs text-slate-200">
          <summary className="cursor-pointer font-semibold">Affiner par niveau et classe</summary>
          <label className="mt-2 block">
            Niveau
            <select className={field} value={selection.level}
              onChange={event => change({ level: event.target.value, classId: "" })}>
              <option value="">Tous les niveaux</option>
              {levels.map(level => <option key={level} value={level}>{level}</option>)}
            </select>
          </label>
          <label className="mt-2 block">
            Classe
            <select className={field} value={selection.classId}
              onChange={event => change({ classId: event.target.value })}>
              <option value="">Toutes les classes</option>
              {availableClasses.map(row => <option key={row.id} value={row.id}>{row.label}</option>)}
            </select>
          </label>
        </details>
        {error && <p role="status" className="mt-2 text-xs text-amber-200">{error}</p>}
      </div>
    </section>
  );
}

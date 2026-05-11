// src/app/drenaet/etablissements/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  Building2,
  CheckCircle2,
  ClipboardList,
  Loader2,
  Medal,
  RefreshCw,
  Search,
  TrendingDown,
  Users,
} from "lucide-react";

type InstitutionState = "normal" | "watch" | "alert" | "silent";
type OperationalStatus = "stable" | "watch" | "critical" | "silent" | "no_schedule";
type GlobalState = "stable" | "watch" | "critical" | "silent" | "config";

type InstitutionRow = {
  id: string;
  name: string;
  code_unique: string;
  code: string;
  regional_direction: string;
  status?: string;
  students: number;
  teachers: number;
  sessions_today: number;
  calls_today: number;
  teacher_coverage_rate: number;
  absences_today: number;
  retards_today: number;
  state: InstitutionState;
};

type PresenceRow = {
  institution_id: string;
  institution_name: string;
  regional_direction: string;
  scheduled: number;
  opened: number;
  held: number;
  not_held: number;
  incomplete: number;
  teachers_seen: number;
  held_rate: number;
  opening_rate: number;
  status: OperationalStatus;
  // Compatibilité éventuelle avec les anciennes réponses.
  sessions?: number;
  confirmed?: number;
  missing?: number;
  coverage_rate?: number;
};

type PresencePayload = {
  ok: boolean;
  range: { fromYmd: string; toYmd: string };
  totals: {
    scheduled: number;
    opened: number;
    held: number;
    not_held: number;
    incomplete: number;
    teachers_seen: number;
    held_rate: number;
    opening_rate: number;
  };
  items: PresenceRow[];
  alerts?: {
    institution_id: string;
    institution_name: string;
    severity: "critical" | "warning" | string;
    message: string;
    scheduled: number;
    held_rate: number;
    not_held: number;
  }[];
};

type MergedInstitution = InstitutionRow & {
  scheduled: number;
  opened: number;
  held: number;
  not_held: number;
  incomplete: number;
  teachers_seen: number;
  held_rate: number;
  opening_rate: number;
  operational_status: OperationalStatus;
  global_state: GlobalState;
  state_label: string;
  state_hint: string;
  risk_score: number;
};

const GLOBAL_STATE_LABELS: Record<GlobalState, string> = {
  stable: "Stable",
  watch: "À surveiller",
  critical: "Critique",
  silent: "Silencieux",
  config: "Configuration incomplète",
};

const GLOBAL_STATE_BADGES: Record<GlobalState, string> = {
  stable: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  watch: "bg-amber-50 text-amber-700 ring-amber-100",
  critical: "bg-red-50 text-red-700 ring-red-100",
  silent: "bg-slate-100 text-slate-700 ring-slate-200",
  config: "bg-violet-50 text-violet-700 ring-violet-100",
};

const BAR_CLASSES: Record<GlobalState, string> = {
  stable: "bg-emerald-500",
  watch: "bg-amber-500",
  critical: "bg-red-500",
  silent: "bg-slate-500",
  config: "bg-violet-500",
};

function nf(value: number | undefined | null) {
  return new Intl.NumberFormat("fr-FR").format(Number(value || 0));
}

function pctText(value: number | undefined | null) {
  const n = Number(value || 0);
  return `${nf(Math.round(n * 10) / 10)}%`;
}

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

function minusDays(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function getGlobalState(item: InstitutionRow, presence?: PresenceRow): GlobalState {
  const scheduled = presence?.scheduled ?? 0;
  const opened = presence?.opened ?? 0;
  const heldRate = presence?.held_rate ?? 0;

  if (scheduled <= 0) return "config";
  if (opened <= 0) return "silent";
  if (heldRate < 50 || item.absences_today >= 30 || item.retards_today >= 20) return "critical";
  if (heldRate < 80 || item.absences_today >= 15 || item.retards_today >= 10) return "watch";
  return "stable";
}

function getStateHint(item: MergedInstitution) {
  if (item.global_state === "config") {
    return "Aucun cours prévu trouvé sur la période : vérifier emplois du temps et créneaux.";
  }
  if (item.global_state === "silent") {
    return "Des cours étaient prévus, mais aucune séance n’a été ouverte.";
  }
  if (item.global_state === "critical") {
    return "Taux de tenue faible ou alertes fortes sur absences/retards.";
  }
  if (item.global_state === "watch") {
    return "Quelques signaux à surveiller : séances non tenues, absences ou retards.";
  }
  return "Activité régulière et indicateurs globalement satisfaisants.";
}

function computeRiskScore(item: MergedInstitution) {
  let score = 0;
  if (item.global_state === "silent") score += 100;
  if (item.global_state === "critical") score += 70;
  if (item.global_state === "watch") score += 35;
  score += Math.min(40, item.not_held * 3);
  score += Math.min(25, item.incomplete * 2);
  score += Math.min(25, item.absences_today * 0.6);
  score += Math.min(15, item.retards_today * 0.5);
  score += Math.max(0, 100 - item.held_rate) * 0.4;
  return Math.round(score * 10) / 10;
}

function StatCard({
  label,
  value,
  helper,
  icon,
}: {
  label: string;
  value: string;
  helper?: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-bold text-slate-500">{label}</p>
          <p className="mt-2 text-3xl font-black tracking-tight text-slate-950">{value}</p>
          {helper ? <p className="mt-1 text-xs font-semibold text-slate-400">{helper}</p> : null}
        </div>
        <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">{icon}</div>
      </div>
    </div>
  );
}

function Badge({ state }: { state: GlobalState }) {
  return (
    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-black ring-1 ${GLOBAL_STATE_BADGES[state]}`}>
      {GLOBAL_STATE_LABELS[state]}
    </span>
  );
}

function MiniBar({ value, state = "stable" }: { value: number; state?: GlobalState }) {
  return (
    <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
      <div className={`h-full rounded-full ${BAR_CLASSES[state]}`} style={{ width: `${clampPercent(value)}%` }} />
    </div>
  );
}

export default function DrenaetEtablissementsPage() {
  const [items, setItems] = useState<InstitutionRow[]>([]);
  const [presence, setPresence] = useState<PresencePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [presenceError, setPresenceError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [state, setState] = useState<"" | GlobalState>("");
  const [from, setFrom] = useState(minusDays(6));
  const [to, setTo] = useState(todayYmd());

  async function load() {
    setLoading(true);
    setError(null);
    setPresenceError(null);

    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());

      const presenceParams = new URLSearchParams({ from, to });

      const [institutionsRes, presenceRes] = await Promise.all([
        fetch(`/api/drenaet/institutions?${params.toString()}`, { cache: "no-store" }),
        fetch(`/api/drenaet/teacher-presence?${presenceParams.toString()}`, { cache: "no-store" }),
      ]);

      const institutionsJson = await institutionsRes.json();
      if (!institutionsRes.ok) {
        throw new Error(institutionsJson?.message || institutionsJson?.error || "Erreur de chargement des établissements.");
      }

      setItems(institutionsJson.items || []);

      const presenceJson = await presenceRes.json();
      if (!presenceRes.ok) {
        setPresence(null);
        setPresenceError(presenceJson?.message || presenceJson?.error || "Indicateurs enseignants indisponibles.");
      } else {
        setPresence(presenceJson);
      }
    } catch (e: any) {
      setError(e?.message || "Erreur inattendue.");
      setItems([]);
      setPresence(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(load, 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, from, to]);

  const presenceByInstitution = useMemo(() => {
    const map = new Map<string, PresenceRow>();
    for (const row of presence?.items || []) {
      map.set(row.institution_id, row);
    }
    return map;
  }, [presence]);

  const mergedItems = useMemo(() => {
    const merged = items.map((item) => {
      const p = presenceByInstitution.get(item.id);
      const globalState = getGlobalState(item, p);

      const row: MergedInstitution = {
        ...item,
        scheduled: p?.scheduled ?? item.sessions_today ?? 0,
        opened: p?.opened ?? item.sessions_today ?? 0,
        held: p?.held ?? p?.confirmed ?? item.calls_today ?? 0,
        not_held: p?.not_held ?? p?.missing ?? Math.max(0, (item.sessions_today || 0) - (item.calls_today || 0)),
        incomplete: p?.incomplete ?? 0,
        teachers_seen: p?.teachers_seen ?? 0,
        held_rate: p?.held_rate ?? p?.coverage_rate ?? item.teacher_coverage_rate ?? 0,
        opening_rate: p?.opening_rate ?? 0,
        operational_status: p?.status ?? "no_schedule",
        global_state: globalState,
        state_label: GLOBAL_STATE_LABELS[globalState],
        state_hint: "",
        risk_score: 0,
      };

      row.state_hint = getStateHint(row);
      row.risk_score = computeRiskScore(row);
      return row;
    });

    return merged.filter((item) => (state ? item.global_state === state : true));
  }, [items, presenceByInstitution, state]);

  const totals = useMemo(() => {
    const base = mergedItems.reduce(
      (acc, item) => {
        acc.students += item.students;
        acc.teachers += item.teachers;
        acc.absences += item.absences_today;
        acc.retards += item.retards_today;
        acc.scheduled += item.scheduled;
        acc.held += item.held;
        acc.notHeld += item.not_held;
        acc.incomplete += item.incomplete;
        if (item.global_state === "stable") acc.stable += 1;
        if (item.global_state === "watch") acc.watch += 1;
        if (item.global_state === "critical") acc.critical += 1;
        if (item.global_state === "silent") acc.silent += 1;
        if (item.global_state === "config") acc.config += 1;
        return acc;
      },
      {
        students: 0,
        teachers: 0,
        absences: 0,
        retards: 0,
        scheduled: 0,
        held: 0,
        notHeld: 0,
        incomplete: 0,
        stable: 0,
        watch: 0,
        critical: 0,
        silent: 0,
        config: 0,
      }
    );

    return {
      ...base,
      heldRate: base.scheduled ? Math.round((base.held / base.scheduled) * 1000) / 10 : 0,
      active: mergedItems.filter((item) => item.held > 0 || item.opened > 0 || item.absences_today > 0 || item.retards_today > 0).length,
      alerts: base.watch + base.critical + base.silent,
    };
  }, [mergedItems]);

  const rankings = useMemo(() => {
    const withSchedule = mergedItems.filter((item) => item.scheduled > 0);
    return {
      bestHeld: [...withSchedule]
        .filter((item) => item.held > 0)
        .sort((a, b) => b.held_rate - a.held_rate || b.held - a.held)
        .slice(0, 5),
      mostRisk: [...mergedItems].sort((a, b) => b.risk_score - a.risk_score).slice(0, 5),
      mostNotHeld: [...withSchedule].sort((a, b) => b.not_held - a.not_held).slice(0, 5),
      mostAbsences: [...mergedItems].sort((a, b) => b.absences_today - a.absences_today).slice(0, 5),
    };
  }, [mergedItems]);

  const statusDistribution = useMemo(
    () => [
      { key: "stable" as GlobalState, label: "Stables", count: totals.stable },
      { key: "watch" as GlobalState, label: "À surveiller", count: totals.watch },
      { key: "critical" as GlobalState, label: "Critiques", count: totals.critical },
      { key: "silent" as GlobalState, label: "Silencieux", count: totals.silent },
      { key: "config" as GlobalState, label: "Config.", count: totals.config },
    ],
    [totals]
  );

  const sortedTable = useMemo(() => {
    return [...mergedItems].sort((a, b) => {
      const order: Record<GlobalState, number> = { critical: 0, silent: 1, watch: 2, config: 3, stable: 4 };
      return order[a.global_state] - order[b.global_state] || b.risk_score - a.risk_score || a.name.localeCompare(b.name, "fr");
    });
  }, [mergedItems]);

  const maxScheduled = Math.max(1, ...mergedItems.map((item) => item.scheduled));

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-slate-950 shadow-sm">
        <div className="bg-[radial-gradient(circle_at_top_right,rgba(124,58,237,0.35),transparent_36%),linear-gradient(135deg,#020617,#312e81_48%,#111827)] p-6 text-white">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-black uppercase tracking-wide text-violet-100">
                <Building2 className="h-4 w-4" />
                Supervision générale
              </div>
              <h1 className="mt-4 text-3xl font-black tracking-tight md:text-4xl">Établissements</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-violet-100">
                Vue exécutive des établissements de votre DRENAET : activité, assiduité, tenue des séances et classements.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
              <div className="rounded-2xl bg-white/10 p-3 ring-1 ring-white/10">
                <p className="text-xs text-violet-100">Période</p>
                <p className="mt-1 font-black">{from} → {to}</p>
              </div>
              <div className="rounded-2xl bg-white/10 p-3 ring-1 ring-white/10">
                <p className="text-xs text-violet-100">Établissements</p>
                <p className="mt-1 font-black">{nf(mergedItems.length)}</p>
              </div>
              <div className="rounded-2xl bg-white/10 p-3 ring-1 ring-white/10">
                <p className="text-xs text-violet-100">Actifs</p>
                <p className="mt-1 font-black">{nf(totals.active)}</p>
              </div>
              <div className="rounded-2xl bg-white/10 p-3 ring-1 ring-white/10">
                <p className="text-xs text-violet-100">Taux tenue</p>
                <p className="mt-1 font-black">{pctText(totals.heldRate)}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Élèves" value={nf(totals.students)} helper="Inscrits dans le périmètre" icon={<Users className="h-5 w-5" />} />
        <StatCard label="Enseignants" value={nf(totals.teachers)} helper="Rôles enseignants rattachés" icon={<ClipboardList className="h-5 w-5" />} />
        <StatCard label="Séances prévues" value={nf(totals.scheduled)} helper="Selon emplois du temps" icon={<BarChart3 className="h-5 w-5" />} />
        <StatCard label="Séances tenues" value={nf(totals.held)} helper={`${nf(totals.notHeld)} non tenue(s)`} icon={<CheckCircle2 className="h-5 w-5" />} />
        <StatCard label="Établissements en alerte" value={nf(totals.alerts)} helper="Critiques, silencieux ou à surveiller" icon={<AlertTriangle className="h-5 w-5" />} />
      </section>

      <section className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto_auto] lg:items-end">
          <label className="relative block">
            <span className="mb-1 block text-xs font-black uppercase tracking-wide text-slate-500">Recherche</span>
            <Search className="pointer-events-none absolute left-3 top-[38px] h-4 w-4 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Rechercher un établissement, code ou DRENAET..."
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-3 text-sm outline-none focus:border-slate-400"
            />
          </label>

          <label>
            <span className="mb-1 block text-xs font-black uppercase tracking-wide text-slate-500">État</span>
            <select
              value={state}
              onChange={(e) => setState(e.target.value as typeof state)}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold outline-none focus:border-slate-400 lg:w-56"
            >
              <option value="">Tous les états</option>
              <option value="stable">Stable</option>
              <option value="watch">À surveiller</option>
              <option value="critical">Critique</option>
              <option value="silent">Silencieux</option>
              <option value="config">Configuration incomplète</option>
            </select>
          </label>

          <label>
            <span className="mb-1 block text-xs font-black uppercase tracking-wide text-slate-500">Du</span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold outline-none focus:border-slate-400"
            />
          </label>

          <label>
            <span className="mb-1 block text-xs font-black uppercase tracking-wide text-slate-500">Au</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold outline-none focus:border-slate-400"
            />
          </label>

          <button
            type="button"
            onClick={load}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white hover:bg-slate-800"
          >
            <RefreshCw className="h-4 w-4" />
            Actualiser
          </button>
        </div>
      </section>

      {presenceError ? (
        <section className="rounded-[24px] border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">
          Indicateurs de tenue des séances indisponibles : {presenceError}
        </section>
      ) : null}

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-black text-slate-950">Répartition par état</h2>
              <p className="text-sm text-slate-500">Lecture rapide du niveau d’attention à donner.</p>
            </div>
            <BarChart3 className="h-5 w-5 text-slate-400" />
          </div>

          <div className="mt-5 space-y-4">
            {statusDistribution.map((row) => {
              const percent = mergedItems.length ? (row.count / mergedItems.length) * 100 : 0;
              return (
                <div key={row.key}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="font-bold text-slate-700">{row.label}</span>
                    <span className="font-black text-slate-950">{nf(row.count)}</span>
                  </div>
                  <MiniBar value={percent} state={row.key} />
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-black text-slate-950">Prévu vs tenu</h2>
              <p className="text-sm text-slate-500">Volume global des cours sur la période.</p>
            </div>
            <ClipboardList className="h-5 w-5 text-slate-400" />
          </div>

          <div className="mt-5 space-y-4">
            <div>
              <div className="mb-1 flex justify-between text-sm"><span className="font-bold">Tenues</span><span className="font-black">{nf(totals.held)}</span></div>
              <MiniBar value={totals.scheduled ? (totals.held / totals.scheduled) * 100 : 0} state="stable" />
            </div>
            <div>
              <div className="mb-1 flex justify-between text-sm"><span className="font-bold">Non tenues</span><span className="font-black">{nf(totals.notHeld)}</span></div>
              <MiniBar value={totals.scheduled ? (totals.notHeld / totals.scheduled) * 100 : 0} state="critical" />
            </div>
            <div>
              <div className="mb-1 flex justify-between text-sm"><span className="font-bold">Incomplètes</span><span className="font-black">{nf(totals.incomplete)}</span></div>
              <MiniBar value={totals.scheduled ? (totals.incomplete / totals.scheduled) * 100 : 0} state="watch" />
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <Medal className="h-5 w-5 text-slate-500" />
            <h2 className="text-lg font-black text-slate-950">Classement — meilleurs taux de tenue</h2>
          </div>
          <div className="mt-4 space-y-3">
            {rankings.bestHeld.length ? rankings.bestHeld.map((item, index) => (
              <div key={item.id} className="rounded-2xl border border-slate-100 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-black text-slate-900">{index + 1}. {item.name}</p>
                    <p className="text-xs font-semibold text-slate-400">{nf(item.held)} tenue(s) / {nf(item.scheduled)} prévue(s)</p>
                  </div>
                  <span className="text-sm font-black text-emerald-700">{pctText(item.held_rate)}</span>
                </div>
                <div className="mt-2"><MiniBar value={item.held_rate} state="stable" /></div>
              </div>
            )) : <p className="text-sm font-semibold text-slate-500">Aucun établissement classable pour l’instant.</p>}
          </div>
        </div>

        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <TrendingDown className="h-5 w-5 text-slate-500" />
            <h2 className="text-lg font-black text-slate-950">Classement — priorités d’intervention</h2>
          </div>
          <div className="mt-4 space-y-3">
            {rankings.mostRisk.length ? rankings.mostRisk.map((item, index) => (
              <div key={item.id} className="rounded-2xl border border-slate-100 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-black text-slate-900">{index + 1}. {item.name}</p>
                    <p className="text-xs font-semibold text-slate-400">{item.state_hint}</p>
                  </div>
                  <Badge state={item.global_state} />
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs font-bold text-slate-500">
                  <span>Non tenues : {nf(item.not_held)}</span>
                  <span>Absences : {nf(item.absences_today)}</span>
                  <span>Taux : {pctText(item.held_rate)}</span>
                </div>
              </div>
            )) : <p className="text-sm font-semibold text-slate-500">Aucune priorité détectée.</p>}
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-black text-slate-950">Plus de séances non tenues</h2>
          <div className="mt-4 space-y-3">
            {rankings.mostNotHeld.length ? rankings.mostNotHeld.map((item) => (
              <div key={item.id} className="grid grid-cols-[minmax(0,1fr)_80px] items-center gap-3">
                <div>
                  <div className="flex justify-between text-sm"><span className="truncate font-bold text-slate-700">{item.name}</span><span className="font-black text-red-700">{nf(item.not_held)}</span></div>
                  <MiniBar value={(item.not_held / Math.max(1, item.scheduled)) * 100} state="critical" />
                </div>
                <span className="text-right text-xs font-bold text-slate-400">/{nf(item.scheduled)}</span>
              </div>
            )) : <p className="text-sm font-semibold text-slate-500">Aucune séance non tenue.</p>}
          </div>
        </div>

        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-black text-slate-950">Plus d’absences élèves aujourd’hui</h2>
          <div className="mt-4 space-y-3">
            {rankings.mostAbsences.length ? rankings.mostAbsences.map((item) => (
              <div key={item.id} className="grid grid-cols-[minmax(0,1fr)_80px] items-center gap-3">
                <div>
                  <div className="flex justify-between text-sm"><span className="truncate font-bold text-slate-700">{item.name}</span><span className="font-black text-amber-700">{nf(item.absences_today)}</span></div>
                  <MiniBar value={item.absences_today ? (item.absences_today / Math.max(1, rankings.mostAbsences[0]?.absences_today || 1)) * 100 : 0} state="watch" />
                </div>
                <span className="text-right text-xs font-bold text-slate-400">absence(s)</span>
              </div>
            )) : <p className="text-sm font-semibold text-slate-500">Aucune absence remontée aujourd’hui.</p>}
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 p-5">
          <h2 className="text-lg font-black text-slate-950">Tableau général des établissements</h2>
          <p className="mt-1 text-sm text-slate-500">
            Les établissements critiques et silencieux remontent automatiquement en tête de liste.
          </p>
        </div>

        {loading ? (
          <div className="flex min-h-[280px] items-center justify-center gap-3 text-sm font-semibold text-slate-600">
            <Loader2 className="h-5 w-5 animate-spin" />
            Chargement des établissements...
          </div>
        ) : error ? (
          <div className="p-5 text-sm font-semibold text-red-700">{error}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[1180px] divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-black uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Établissement</th>
                  <th className="px-4 py-3">DRENAET</th>
                  <th className="px-4 py-3 text-right">Élèves</th>
                  <th className="px-4 py-3 text-right">Ens.</th>
                  <th className="px-4 py-3 text-right">Prévues</th>
                  <th className="px-4 py-3 text-right">Tenues</th>
                  <th className="px-4 py-3 text-right">Non tenues</th>
                  <th className="px-4 py-3 text-right">Incomplètes</th>
                  <th className="px-4 py-3 text-right">Absences</th>
                  <th className="px-4 py-3 text-right">Retards</th>
                  <th className="px-4 py-3">Taux tenue</th>
                  <th className="px-4 py-3">État</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedTable.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3">
                      <p className="font-black text-slate-900">{item.name}</p>
                      <p className="text-xs text-slate-500">{item.code_unique || item.code || "Code non renseigné"}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{item.regional_direction || "—"}</td>
                    <td className="px-4 py-3 text-right font-bold">{nf(item.students)}</td>
                    <td className="px-4 py-3 text-right font-bold">{nf(item.teachers)}</td>
                    <td className="px-4 py-3 text-right font-bold">{nf(item.scheduled)}</td>
                    <td className="px-4 py-3 text-right font-bold text-emerald-700">{nf(item.held)}</td>
                    <td className="px-4 py-3 text-right font-bold text-red-700">{nf(item.not_held)}</td>
                    <td className="px-4 py-3 text-right font-bold text-amber-700">{nf(item.incomplete)}</td>
                    <td className="px-4 py-3 text-right font-bold">{nf(item.absences_today)}</td>
                    <td className="px-4 py-3 text-right font-bold">{nf(item.retards_today)}</td>
                    <td className="px-4 py-3 min-w-40">
                      <div className="flex items-center justify-between gap-2 text-xs font-black text-slate-700">
                        <span>{pctText(item.held_rate)}</span>
                        <span>{nf(item.held)}/{nf(item.scheduled)}</span>
                      </div>
                      <div className="mt-1"><MiniBar value={item.held_rate} state={item.global_state} /></div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge state={item.global_state} />
                      <p className="mt-1 max-w-[260px] text-xs font-semibold text-slate-400">{item.state_hint}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!sortedTable.length ? (
              <div className="p-6 text-center text-sm font-semibold text-slate-500">Aucun établissement trouvé.</div>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}

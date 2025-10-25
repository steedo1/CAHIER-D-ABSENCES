// src/app/admin/dashboard/AdminDashboardClient.tsx (ou le bon chemin)
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  School,
  Users,
  UserRoundCheck,
  GraduationCap,
  CalendarClock,
  AlarmClock,
  RefreshCw,
  ChevronRight,
  TrendingUp,
  AlertTriangle,
  Clock4,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

/* ─────────────────────────────
   Types d'API
───────────────────────────── */
type MetricsOk = {
  ok: true;
  counts: { classes: number; teachers: number; parents: number; students: number };
  kpis: { absences: number; retards: number };
};

type MetricsErr = { ok: false; error: string };
type DaysRange = 7 | 30 | 90;

/* ─────────────────────────────
   Petites briques UI
───────────────────────────── */
function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-slate-200/70 ${className}`} />;
}

function CountUp({ value, duration = 700, className = "" }: { value: number; duration?: number; className?: string }) {
  const [display, setDisplay] = useState(0);
  const prev = useRef(0);
  useEffect(() => {
    const start = performance.now();
    const from = prev.current;
    const diff = value - from;
    let raf = 0;
    function tick(t: number) {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      setDisplay(Math.round(from + diff * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    prev.current = value;
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return (
    <span className={className} aria-live="polite" aria-atomic>
      {display.toLocaleString()}
    </span>
  );
}

function StatCard({
  label,
  value,
  Icon,
  accent = "emerald",
  loading,
}: {
  label: string;
  value: number;
  Icon: any;
  accent?: "emerald" | "teal" | "sky" | "violet" | "amber";
  loading?: boolean;
}) {
  const ring = useMemo(() => {
    switch (accent) {
      case "teal":
        return "ring-teal-500/30 hover:ring-teal-500/40";
      case "sky":
        return "ring-sky-500/30 hover:ring-sky-500/40";
      case "violet":
        return "ring-violet-500/30 hover:ring-violet-500/40";
      case "amber":
        return "ring-amber-500/30 hover:ring-amber-500/40";
      default:
        return "ring-emerald-500/30 hover:ring-emerald-500/40";
    }
  }, [accent]);

  return (
    <Card className={`rounded-2xl border-slate-200/80 shadow-sm ring-1 transition ${ring}`}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <div className="text-sm text-slate-500">{label}</div>
            <div className="text-3xl font-semibold tracking-tight">
              {loading ? <Skeleton className="h-8 w-16" /> : <CountUp value={value} />}
            </div>
          </div>
          <div className="rounded-xl bg-gradient-to-br from-white to-slate-50 p-3 ring-1 ring-slate-200">
            <Icon className="h-6 w-6 text-slate-600" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function KpiCard({
  title,
  value,
  hint,
  tone = "red",
  loading,
}: {
  title: string;
  value: number;
  hint?: string;
  tone?: "red" | "amber" | "emerald";
  loading?: boolean;
}) {
  const tones = {
    red: {
      ring: "ring-red-500/30",
      chip: "bg-red-50 text-red-700",
      icon: <AlertTriangle className="h-4 w-4" />,
      bg: "from-red-50 to-white",
      border: "border-red-200/70",
    },
    amber: {
      ring: "ring-amber-500/30",
      chip: "bg-amber-50 text-amber-800",
      icon: <AlarmClock className="h-4 w-4" />,
      bg: "from-amber-50 to-white",
      border: "border-amber-200/70",
    },
    emerald: {
      ring: "ring-emerald-500/30",
      chip: "bg-emerald-50 text-emerald-700",
      icon: <TrendingUp className="h-4 w-4" />,
      bg: "from-emerald-50 to-white",
      border: "border-emerald-200/70",
    },
  } as const;

  const t = tones[tone];

  return (
    <Card className={`rounded-2xl shadow-sm ring-1 ${t.ring} ${t.border} border bg-gradient-to-b ${t.bg}`}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm text-slate-600">
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs ${t.chip}`}>
            {t.icon}
            30 derniers jours
          </span>
          <span className="sr-only">{hint}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="text-3xl font-semibold">
          {loading ? <Skeleton className="h-8 w-20" /> : <CountUp value={value} />}
        </div>
        {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function QuickLink({ href, icon: Icon, children }: { href: string; icon: any; children: React.ReactNode }) {
  return (
    <Link href={href} className="group">
      <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 shadow-sm transition hover:border-emerald-300 hover:bg-emerald-100">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-white p-2 text-emerald-700 ring-1 ring-emerald-100">
            <Icon className="h-5 w-5" />
          </div>
          <span className="text-sm font-medium text-emerald-900 group-hover:text-emerald-950">{children}</span>
        </div>
        <ChevronRight className="h-5 w-5 text-emerald-500 transition group-hover:translate-x-0.5" />
      </div>
    </Link>
  );
}

function Segmented({ value, onChange }: { value: DaysRange; onChange: (v: DaysRange) => void }) {
  const opts: DaysRange[] = [7, 30, 90];
  return (
    <div className="inline-flex rounded-full border border-emerald-200 bg-white p-1 text-sm shadow-sm">
      {opts.map((d) => (
        <button
          key={d}
          type="button"
          onClick={() => onChange(d)}
          className={`rounded-full px-3 py-1.5 transition ${
            value === d ? "bg-emerald-600 text-white shadow" : "text-emerald-700 hover:bg-emerald-50"
          }`}
          aria-pressed={value === d}
        >
          {d}j
        </button>
      ))}
    </div>
  );
}

/* ─────────────────────────────
   Barre supérieure bleue (option)
───────────────────────────── */
export function ColoredTopbar({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={[
        "mb-4 flex items-center justify-between rounded-2xl",
        "border border-blue-900/60 ring-1 ring-blue-800/40",
        "bg-blue-950 text-white shadow-sm",
        "px-4 py-3",
        className,
      ].join(" ")}
    >
      {children}
    </div>
  );
}

/* ─────────────────────────────
   Composant principal
───────────────────────────── */
export default function AdminDashboardClient() {
  const [data, setData] = useState<MetricsOk | MetricsErr | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [days, setDays] = useState<DaysRange>(30);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const nfmt = useMemo(() => new Intl.NumberFormat(), []);
  void nfmt; // (dispo si tu veux formatter autre chose)

  async function load(d: DaysRange = days) {
    try {
      setRefreshing(true);
      const r = await fetch(`/api/admin/dashboard/metrics?days=${d}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || `HTTP_${r.status}`);
      setData(j);
      setUpdatedAt(new Date());
    } catch (e: any) {
      setData({ ok: false, error: e?.message ?? "NETWORK_ERROR" });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/admin/dashboard/metrics?days=${days}`, { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        if (!alive) return;
        if (!r.ok) throw new Error(j?.error || `HTTP_${r.status}`);
        setData(j);
        setUpdatedAt(new Date());
      } catch (e: any) {
        if (!alive) return;
        setData({ ok: false, error: e?.message ?? "NETWORK_ERROR" });
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isOk = data && "ok" in data && data.ok;
  const counts = isOk ? (data as MetricsOk).counts : { classes: 0, teachers: 0, parents: 0, students: 0 };
  const absences = isOk ? (data as MetricsOk).kpis?.absences ?? 0 : 0;
  const retards = isOk ? (data as MetricsOk).kpis?.retards ?? 0 : 0;

  return (
    <div className="space-y-6">
      {/* En-tête gradient (section héro) */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-emerald-600 via-lime-500 to-amber-500 p-6 text-white">
        <div
          className="pointer-events-none absolute inset-0 opacity-20"
          style={{
            background:
              "radial-gradient(500px 200px at 10% -10%, rgba(255,255,255,0.6), transparent 60%), radial-gradient(300px 120px at 90% 120%, rgba(255,255,255,0.4), transparent 60%)",
          }}
        />
        <div className="relative z-10 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight drop-shadow-sm">Espace établissement</h1>
            <p className="mt-1 text-sm/6 text-white/90">Vue d&apos;ensemble de votre établissement scolaire</p>
          </div>
          <div className="flex items-center gap-2">
            <Segmented
              value={days}
              onChange={(d) => {
                setDays(d);
                load(d);
              }}
            />
            <Badge variant="secondary" className="bg-white/20 text-white hover:bg-white/30">
              <CalendarClock className="mr-1 h-3.5 w-3.5" />
              Aujourd&apos;hui
            </Badge>
            <Button
              variant="secondary"
              className="bg-white text-emerald-700 hover:bg-white/90"
              onClick={() => load(days)}
              disabled={refreshing}
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              Actualiser
            </Button>
          </div>
        </div>

        {/* État d'erreur affiché sous le header si présent */}
        {!loading && data && "ok" in data && !data.ok && (
          <div className="relative z-10 mt-4 rounded-xl border border-red-300/60 bg-red-50/80 px-4 py-3 text-sm text-red-800">
            {(data as MetricsErr).error === "UNAUTHENTICATED"
              ? "Session expirée. Réactualisez la page ou reconnectez-vous."
              : (data as MetricsErr).error === "FORBIDDEN"
              ? "Accès non autorisé."
              : "Erreur lors du chargement des métriques."}
          </div>
        )}
      </div>

      {/* Cartes de compteurs */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Classes" value={counts.classes} Icon={School} accent="emerald" loading={loading} />
        <StatCard label="Enseignants" value={counts.teachers} Icon={Users} accent="teal" loading={loading} />
        <StatCard label="Parents" value={counts.parents} Icon={UserRoundCheck} accent="sky" loading={loading} />
        <StatCard label="Élèves" value={counts.students} Icon={GraduationCap} accent="violet" loading={loading} />
      </section>

      {/* KPIs + Raccourcis */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <KpiCard
          title="Absences / période"
          value={absences}
          hint="Total des absences enregistrées sur la période"
          tone="red"
          loading={loading}
        />
        <KpiCard
          title="Retards / période"
          value={retards}
          hint="Total des retards enregistrés sur la période"
          tone="amber"
          loading={loading}
        />
        <Card className="rounded-2xl border-emerald-200 bg-emerald-50/50 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-emerald-900">Raccourcis</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-2">
              <QuickLink href="/admin/classes" icon={School}>
                Créer des classes
              </QuickLink>
              <QuickLink href="/admin/users" icon={Users}>
                Créer un enseignant
              </QuickLink>
              <QuickLink href="/admin/affectations" icon={UserRoundCheck}>
                Affecter des classes
              </QuickLink>
              <QuickLink href="/admin/parents" icon={Users}>
                Gérer les parents
              </QuickLink>
              <QuickLink href="/admin/import" icon={GraduationCap}>
                Importer élèves
              </QuickLink>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Petit bandeau info / onboarding */}
      {!loading && isOk && counts.classes === 0 && (
        <Card className="rounded-2xl border-amber-200 bg-amber-50/60 shadow-sm">
          <CardContent className="flex flex-col items-start gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="font-medium text-amber-900">Commencez par créer vos classes</div>
              <div className="text-sm text-amber-800/90">
                Aucune classe trouvée pour le moment. Ajoutez vos classes pour activer la prise de présence.
              </div>
            </div>
            <Button asChild className="bg-amber-600 text-white hover:bg-amber-600/90">
              <Link href="/admin/classes">
                <School className="mr-2 h-4 w-4" /> Créer des classes
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between">
        <Separator className="my-2" />
      </div>
      <div className="flex items-center justify-between text-xs text-slate-400">
        <div>© {new Date().getFullYear()} Mon Cahier d’Absences · Tableau de bord</div>
        <div className="inline-flex items-center gap-1 text-slate-400">
          <Clock4 className="h-3.5 w-3.5" />
          {updatedAt ? `Mis à jour à ${updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "—"}
        </div>
      </div>
    </div>
  );
}

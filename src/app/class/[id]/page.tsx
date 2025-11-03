// src/app/class/[id]/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { Play, Clock, BookOpen } from "lucide-react";

type Discipline = {
  subject_id: string | null;
  subject_name: string | null;
  teacher_id: string | null;
  teacher_name: string | null;
};
type ClassInfo = {
  id: string;
  label: string;
  level: string | null;
  institution_id: string;
  class_phone_e164?: string | null;
};

async function getJsonOrThrow(url: string) {
  const r = await fetch(url, { cache: "no-store" });
  const ct = r.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    const txt = await r.text().catch(() => "");
    throw new Error(`HTTP ${r.status} ${r.statusText} — ${txt.slice(0,160)}`);
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
  return j;
}

function Select(p: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...p}
      className={[
        "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm",
        "shadow-sm outline-none transition",
        "focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/20",
        "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400",
        p.className ?? "",
      ].join(" ")}
    />
  );
}
function Input(p: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...p}
      className={[
        "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm",
        "shadow-sm outline-none transition",
        "placeholder:text-slate-400",
        "focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/20",
        "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400",
        p.className ?? "",
      ].join(" ")}
    />
  );
}
function Button(
  p: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "emerald" | "slate" }
) {
  const tone = p.tone ?? "emerald";
  const base =
    "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium shadow transition focus:outline-none focus:ring-4 disabled:opacity-60 disabled:cursor-not-allowed";
  const tones: Record<"emerald" | "slate", string> = {
    emerald: "bg-emerald-600 text-white hover:bg-emerald-700 focus:ring-emerald-500/30",
    slate: "bg-slate-900 text-white hover:bg-slate-800 focus:ring-slate-600/30",
  };
  const cls = [base, tones[tone], p.className ?? ""].join(" ");
  const { tone: _tone, ...rest } = p;
  return <button {...rest} className={cls} />;
}

export default function ClassDashboardPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const classId = params?.id;

  const [loading, setLoading] = useState(true);
  const [klass, setKlass] = useState<ClassInfo | null>(null);
  const [disciplines, setDisciplines] = useState<Discipline[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const [selKey, setSelKey] = useState<string>(""); // subject_id|teacher_id
  const [duration, setDuration] = useState<number>(60);

  const now = new Date();
  const defTime = new Date(now.getTime() - now.getMinutes() * 60000).toTimeString().slice(0, 5);
  const [startTime, setStartTime] = useState<string>(defTime);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const options = useMemo(() => {
    return disciplines.map((d, i) => ({
      key: `${d.subject_id ?? ""}|${d.teacher_id ?? ""}|${i}`,
      label: `${d.subject_name ?? "—"}${d.teacher_name ? ` — ${d.teacher_name}` : ""}`,
      value: d,
    }));
  }, [disciplines]);

  useEffect(() => {
    if (!classId) return;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        // ⬇️ sécurisé par téléphone: /api/class/device/[id]
        const j = await getJsonOrThrow(`/api/class/device/${encodeURIComponent(String(classId))}`);
        setKlass(j.class as ClassInfo);
        setDisciplines((j.disciplines || []) as Discipline[]);
      } catch (e: any) {
        setErr(e?.message || "Impossible de charger la classe.");
        setKlass(null);
        setDisciplines([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [classId]);

  async function startFromClassDevice() {
    setBusy(true);
    setMsg(null);
    try {
      if (!klass) throw new Error("Classe inconnue.");
      const opt = options.find((o) => o.key === selKey);
      if (!opt) throw new Error("Sélectionnez la discipline.");
      const d = opt.value;

      const today = new Date();
      const [hh, mm] = (startTime || "08:00").split(":").map((x) => +x);
      const started = new Date(today.getFullYear(), today.getMonth(), today.getDate(), hh, mm, 0, 0);

      const r = await fetch("/api/class/sessions/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          class_id: klass.id,
          subject_id: d.subject_id,
          teacher_id: d.teacher_id,
          started_at: started.toISOString(),
          expected_minutes: duration,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || "Échec d’ouverture de séance.");
      setMsg("Séance démarrée sur ce téléphone de classe ✅");
    } catch (e: any) {
      setMsg(e?.message || "Échec d’ouverture de séance.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Classe — Démarrer l’appel</h1>
        <p className="text-slate-600 text-sm">
          Ce téléphone est dédié à la classe. Choisissez votre discipline et démarrez l’appel.
        </p>
      </header>

      {err && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>
      )}

      {loading ? (
        <div className="text-sm text-slate-600">Chargement…</div>
      ) : !klass ? (
        <div className="text-sm text-slate-600">Classe introuvable.</div>
      ) : (
        <section className="rounded-2xl border bg-white p-5 shadow-sm space-y-4">
          <div className="text-slate-800">
            <div className="text-lg font-semibold">{klass.label}</div>
            <div className="text-xs text-slate-500">{klass.level || "Niveau —"}</div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="md:col-span-2">
              <div className="mb-1 flex items-center gap-2 text-xs text-slate-500">
                <BookOpen className="h-3.5 w-3.5" />
                Discipline — Professeur
              </div>
              <Select value={selKey} onChange={(e) => setSelKey(e.target.value)}>
                <option value="">— Sélectionner —</option>
                {options.map((o) => (
                  <option key={o.key} value={o.key}>{o.label}</option>
                ))}
              </Select>
              <div className="mt-1 text-[11px] text-slate-500">
                Seules les disciplines affectées à cette classe apparaissent.
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center gap-2 text-xs text-slate-500">
                <Clock className="h-3.5 w-3.5" />
                Heure de début
              </div>
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
              <div className="mt-2">
                <div className="mb-1 flex items-center gap-2 text-xs text-slate-500">
                  <Clock className="h-3.5 w-3.5" />
                  Durée (minutes)
                </div>
                <Select value={String(duration)} onChange={(e) => setDuration(parseInt(e.target.value, 10))}>
                  {[30, 45, 60, 90, 120].map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </Select>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={startFromClassDevice} disabled={!selKey || busy}>
              <Play className="h-4 w-4" />
              {busy ? "Démarrage…" : "Démarrer l’appel"}
            </Button>
          </div>

          {msg && <div className="text-sm text-slate-700" aria-live="polite">{msg}</div>}
        </section>
      )}
    </main>
  );
}

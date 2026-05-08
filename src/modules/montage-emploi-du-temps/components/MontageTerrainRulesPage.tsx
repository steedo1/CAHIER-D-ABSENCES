"use client";

import React from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Save } from "lucide-react";
import MontageSectionShell from "./MontageSectionShell";

type Rules = {
  avoidBreakInsideMultiPeriodBlock: boolean;
  enablePcSvtTandem: boolean;
  pcSvtTandemScope: "disabled" | "all_classes" | "selected_classes";
  pcSvtTandemMode: "parallel" | "rotation";
  pcSvtTandemClassIds: string[];
  allowPcInOrdinaryRoomWhenNoLab: boolean;
  allowSvtInOrdinaryRoomWhenNoLab: boolean;
  allowEpsInOrdinaryRoomWhenNoField: boolean;
  allowComputerInOrdinaryRoomWhenNoLab: boolean;
  treatSportsFieldAsSharedResource?: boolean;
  epsMaxSimultaneousCoursesPerField: number;
  epsHotHourMode: "disabled" | "soft" | "strict";
  avoidStudentGaps: boolean;
  avoidTeacherGaps: boolean;
  avoidSingleHourReturn: boolean;
  avoidHeavySubjectsBackToBack: boolean;
  avoidSameSubjectSameDay: boolean;
  balanceHalfDays: boolean;
  preferMainClassRoom: boolean;
};

type RulesResponse =
  | { ok: true; rules: Rules; message?: string }
  | { ok: false; error: string; message?: string };

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-5 w-5 rounded border-slate-300 text-emerald-600"
      />
    </label>
  );
}

export default function MontageTerrainRulesPage() {
  const [rules, setRules] = React.useState<Rules | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/admin/montage-emploi-du-temps/regles-terrain", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as RulesResponse | null;
      if (!json) return setError("Réponse serveur invalide.");
      if (!json.ok) return setError(json.message || json.error);
      setRules(json.rules);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de charger les règles terrain.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  function patch(patchValue: Partial<Rules>) {
    setRules((current) => (current ? { ...current, ...patchValue } : current));
  }

  async function save() {
    if (!rules) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/admin/montage-emploi-du-temps/regles-terrain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules }),
      });
      const json = (await res.json().catch(() => null)) as RulesResponse | null;
      if (!json) return setError("Réponse serveur invalide pendant la sauvegarde.");
      if (!json.ok) return setError(json.message || json.error);
      setSuccess(json.message || "Règles terrain sauvegardées.");
      setRules(json.rules);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de sauvegarder les règles terrain.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <MontageSectionShell
      title="Règles terrain"
      description="Configurer les options déjà prévues par TerrainRulesPanel dans HoraClasse : tandems, ressources, EPS et qualité du montage."
      status="TerrainRulesPanel"
      note="Cette page expose les règles HoraClasse existantes. Elle n’invente pas de nouvelles règles métier : elle alimente le scheduler HoraClasse."
      cards={[
        { title: "Tandem P.C / SVT", description: "Activation optionnelle, portée toutes classes ou classes sélectionnées, mode parallèle ou rotation." },
        { title: "Ressources terrain", description: "Laboratoires P.C/SVT, terrain EPS, salle informatique et fallback en salle ordinaire selon configuration." },
        { title: "Qualité HoraClasse", description: "Trous élèves/profs, retours inutiles, matières lourdes successives et équilibre des demi-journées." },
      ]}
    >
      <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-black text-slate-950">Options du scheduler HoraClasse</h2>
            <p className="mt-1 text-sm text-slate-500">Ces valeurs seront injectées dans terrainRules.</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => void load()} disabled={loading || saving} className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 hover:bg-slate-50 disabled:opacity-60">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Recharger
            </button>
            <button type="button" onClick={() => void save()} disabled={!rules || saving} className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-black text-white hover:bg-emerald-700 disabled:opacity-60">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Sauvegarder
            </button>
          </div>
        </div>

        {error && <div className="mt-5 rounded-3xl border border-red-200 bg-red-50 p-5 text-red-950"><div className="flex gap-3"><AlertTriangle className="mt-0.5 h-5 w-5" /><div><p className="font-black">Erreur</p><p className="text-sm">{error}</p></div></div></div>}
        {success && <div className="mt-5 rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950"><div className="flex gap-3"><CheckCircle2 className="mt-0.5 h-5 w-5" /><div><p className="font-black">Action réussie</p><p className="text-sm">{success}</p></div></div></div>}

        {loading ? (
          <div className="mt-6 flex items-center gap-3 text-sm font-semibold text-slate-600"><Loader2 className="h-5 w-5 animate-spin" /> Chargement des règles terrain...</div>
        ) : rules ? (
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <Toggle label="Éviter de couper un bloc par une pause" checked={rules.avoidBreakInsideMultiPeriodBlock} onChange={(v) => patch({ avoidBreakInsideMultiPeriodBlock: v })} />
            <Toggle label="Activer le tandem P.C / SVT" checked={rules.enablePcSvtTandem} onChange={(v) => patch({ enablePcSvtTandem: v, pcSvtTandemScope: v ? "all_classes" : "disabled" })} />
            <label className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800">
              <span>Mode tandem P.C/SVT</span>
              <select value={rules.pcSvtTandemMode} onChange={(e) => patch({ pcSvtTandemMode: e.target.value as Rules["pcSvtTandemMode"] })} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2">
                <option value="parallel">Parallèle</option>
                <option value="rotation">Rotation</option>
              </select>
            </label>
            <label className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800">
              <span>EPS : heures chaudes</span>
              <select value={rules.epsHotHourMode} onChange={(e) => patch({ epsHotHourMode: e.target.value as Rules["epsHotHourMode"] })} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2">
                <option value="disabled">Désactivé</option>
                <option value="soft">Souple</option>
                <option value="strict">Strict</option>
              </select>
            </label>
            <Toggle label="Autoriser P.C en salle ordinaire si pas de labo" checked={rules.allowPcInOrdinaryRoomWhenNoLab} onChange={(v) => patch({ allowPcInOrdinaryRoomWhenNoLab: v })} />
            <Toggle label="Autoriser SVT en salle ordinaire si pas de labo" checked={rules.allowSvtInOrdinaryRoomWhenNoLab} onChange={(v) => patch({ allowSvtInOrdinaryRoomWhenNoLab: v })} />
            <Toggle label="Autoriser EPS en salle ordinaire si pas de terrain" checked={rules.allowEpsInOrdinaryRoomWhenNoField} onChange={(v) => patch({ allowEpsInOrdinaryRoomWhenNoField: v })} />
            <Toggle label="Autoriser informatique en salle ordinaire" checked={rules.allowComputerInOrdinaryRoomWhenNoLab} onChange={(v) => patch({ allowComputerInOrdinaryRoomWhenNoLab: v })} />
            <Toggle label="Éviter les trous élèves" checked={rules.avoidStudentGaps} onChange={(v) => patch({ avoidStudentGaps: v })} />
            <Toggle label="Éviter les trous professeurs" checked={rules.avoidTeacherGaps} onChange={(v) => patch({ avoidTeacherGaps: v })} />
            <Toggle label="Éviter le retour professeur pour une seule heure" checked={rules.avoidSingleHourReturn} onChange={(v) => patch({ avoidSingleHourReturn: v })} />
            <Toggle label="Éviter les matières lourdes successives" checked={rules.avoidHeavySubjectsBackToBack} onChange={(v) => patch({ avoidHeavySubjectsBackToBack: v })} />
            <Toggle label="Éviter la même matière le même jour" checked={rules.avoidSameSubjectSameDay} onChange={(v) => patch({ avoidSameSubjectSameDay: v })} />
            <Toggle label="Équilibrer les demi-journées" checked={rules.balanceHalfDays} onChange={(v) => patch({ balanceHalfDays: v })} />
            <Toggle label="Préférer la salle principale de la classe" checked={rules.preferMainClassRoom} onChange={(v) => patch({ preferMainClassRoom: v })} />
          </div>
        ) : null}
      </div>
    </MontageSectionShell>
  );
}

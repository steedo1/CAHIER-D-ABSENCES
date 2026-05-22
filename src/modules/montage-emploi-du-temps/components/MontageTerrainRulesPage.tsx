"use client";

import React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Dumbbell,
  FlaskConical,
  Gauge,
  Loader2,
  Monitor,
  Plus,
  RefreshCw,
  Save,
  School,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import MontageSectionShell from "./MontageSectionShell";

type TandemScope = "disabled" | "all_classes" | "selected_classes";
type TandemMode = "parallel" | "rotation";
type EpsHotHourMode = "disabled" | "soft" | "strict";
type InstitutionRulePriority = "hard" | "strong" | "medium" | "soft";
type InstitutionRuleBehavior = "prefer" | "avoid" | "require" | "forbid";
type InstitutionRuleScope = "all" | "level" | "class" | "subject" | "teacher";
type HalfDay = "morning" | "afternoon" | "evening";

type InstitutionRule = {
  id: string;
  name: string;
  description?: string | null;
  enabled: boolean;
  priority: InstitutionRulePriority;
  behavior: InstitutionRuleBehavior;
  scope: InstitutionRuleScope;
  dayIndexes: number[];
  periodIndexes: number[];
  halfDays: HalfDay[];
  classIds: string[];
  levelCodes: string[];
  subjectIds: string[];
  teacherIds: string[];
  startTime?: string | null;
  endTime?: string | null;
};

type Rules = {
  avoidBreakInsideMultiPeriodBlock: boolean;
  enablePcSvtTandem: boolean;
  pcSvtTandemScope: TandemScope;
  pcSvtTandemMode: TandemMode;
  pcSvtTandemClassIds: string[];
  allowPcInOrdinaryRoomWhenNoLab: boolean;
  allowSvtInOrdinaryRoomWhenNoLab: boolean;
  allowEpsInOrdinaryRoomWhenNoField: boolean;
  allowComputerInOrdinaryRoomWhenNoLab: boolean;
  treatSportsFieldAsSharedResource: boolean;
  epsMaxSimultaneousCoursesPerField: number;
  epsHotHourMode: EpsHotHourMode;
  avoidStudentGaps: boolean;
  avoidTeacherGaps: boolean;
  avoidSingleHourReturn: boolean;
  avoidHeavySubjectsBackToBack: boolean;
  avoidSameSubjectSameDay: boolean;
  balanceHalfDays: boolean;
  preferMainClassRoom: boolean;
  institutionRules: InstitutionRule[];
};

type ClassOption = {
  id: string;
  label: string;
  level: string | null;
};

type Stats = {
  classes: number;
  pc_labs: number;
  svt_labs: number;
  sports_fields: number;
  computer_labs: number;
};

type RulesResponse =
  | { ok: true; rules: Rules; classes?: ClassOption[]; stats?: Stats; updated_at?: string | null; message?: string }
  | { ok: false; error: string; message?: string };

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number | string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-slate-500">{label}</p>
          <p className="mt-2 text-3xl font-black tracking-tight text-slate-950">{value}</p>
        </div>
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-50 text-slate-700 ring-1 ring-slate-200">
          <Icon className="h-6 w-6" />
        </div>
      </div>
    </div>
  );
}

function ToggleCard({
  title,
  description,
  checked,
  onChange,
  disabled,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-4 rounded-3xl border p-4 transition ${
        checked
          ? "border-emerald-200 bg-emerald-50 text-emerald-950"
          : "border-slate-200 bg-white text-slate-900 hover:bg-slate-50"
      } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-5 w-5 rounded border-slate-300 text-emerald-600"
      />
      <span>
        <strong className="block text-sm font-black">{title}</strong>
        <em className="mt-1 block text-sm not-italic text-slate-500">{description}</em>
      </span>
    </label>
  );
}

function RuleBlock({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-5">
        <h2 className="text-xl font-black text-slate-950">{title}</h2>
        <p className="mt-1 text-sm text-slate-500">{description}</p>
      </div>
      {children}
    </section>
  );
}

function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <label className="block">
      <span className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-900 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}


const DAYS = [
  { value: 1, label: "Lun" },
  { value: 2, label: "Mar" },
  { value: 3, label: "Mer" },
  { value: 4, label: "Jeu" },
  { value: 5, label: "Ven" },
  { value: 6, label: "Sam" },
];

const HALF_DAY_OPTIONS: Array<{ value: HalfDay; label: string }> = [
  { value: "morning", label: "Matin" },
  { value: "afternoon", label: "Après-midi" },
  { value: "evening", label: "Soir" },
];

function makeRuleId() {
  return `rule_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function defaultInstitutionRule(): InstitutionRule {
  return {
    id: makeRuleId(),
    name: "Nouvelle règle établissement",
    description: "",
    enabled: true,
    priority: "medium",
    behavior: "prefer",
    scope: "all",
    dayIndexes: [],
    periodIndexes: [],
    halfDays: [],
    classIds: [],
    levelCodes: [],
    subjectIds: [],
    teacherIds: [],
    startTime: null,
    endTime: null,
  };
}

function csvToList(value: string): string[] {
  return value
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function listToCsv(value: string[]) {
  return value.join(", ");
}

function numberCsvToList(value: string): number[] {
  return Array.from(
    new Set(
      value
        .split(/[;,]/)
        .map((item) => Number(item.trim()))
        .filter((item) => Number.isInteger(item) && item >= 1 && item <= 20),
    ),
  ).sort((a, b) => a - b);
}

function numberListToCsv(value: number[]) {
  return value.join(", ");
}

function toggleValue<T extends string | number>(values: T[], value: T, checked: boolean): T[] {
  if (checked) return Array.from(new Set([...values, value]));
  return values.filter((item) => item !== value);
}

function InstitutionRulesEditor({
  rules,
  classes,
  onChange,
}: {
  rules: InstitutionRule[];
  classes: ClassOption[];
  onChange: (rules: InstitutionRule[]) => void;
}) {
  function updateRule(id: string, patch: Partial<InstitutionRule>) {
    onChange(rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)));
  }

  function addRule(template?: Partial<InstitutionRule>) {
    onChange([...rules, { ...defaultInstitutionRule(), ...template, id: makeRuleId() }]);
  }

  function addRules(templates: Array<Partial<InstitutionRule>>) {
    onChange([
      ...rules,
      ...templates.map((template) => ({ ...defaultInstitutionRule(), ...template, id: makeRuleId() })),
    ]);
  }

  function removeRule(id: string) {
    onChange(rules.filter((rule) => rule.id !== id));
  }

  return (
    <RuleBlock
      title="Règles établissement"
      description="Chaque école peut ajouter ses contraintes propres avec un niveau de priorité. Ces règles guident le moteur et ressortent dans les diagnostics."
    >
      <div className="mb-5 grid gap-3 lg:grid-cols-4">
        <button
          type="button"
          onClick={() => addRule({ name: "Favoriser la première heure lundi/vendredi", behavior: "prefer", priority: "strong", scope: "all", dayIndexes: [1, 5], periodIndexes: [1] })}
          className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm font-black text-slate-800 hover:bg-white"
        >
          + Première heure lundi/vendredi
        </button>
        <button
          type="button"
          onClick={() => addRule({ name: "Lundi : devoirs 3e et Terminale", behavior: "prefer", priority: "medium", scope: "level", dayIndexes: [1], levelCodes: ["3e", "terminale", "tle"] })}
          className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm font-black text-slate-800 hover:bg-white"
        >
          + Devoirs 3e / Terminale
        </button>
        <button
          type="button"
          onClick={() => addRule({ name: "Jeudi : devoirs classes intermédiaires", behavior: "prefer", priority: "medium", scope: "level", dayIndexes: [4], levelCodes: ["6e", "5e", "4e", "2nde", "1re"] })}
          className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm font-black text-slate-800 hover:bg-white"
        >
          + Devoirs intermédiaires
        </button>
        <button
          type="button"
          onClick={() => addRules([
            { name: "EPS : matin 7h15-11h10", behavior: "prefer", priority: "strong", scope: "subject", subjectIds: ["eps"], startTime: "07:15", endTime: "11:10", halfDays: ["morning"] },
            { name: "EPS : après-midi 15h25-17h15", behavior: "prefer", priority: "strong", scope: "subject", subjectIds: ["eps"], startTime: "15:25", endTime: "17:15", halfDays: ["afternoon"] },
          ])}
          className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm font-black text-slate-800 hover:bg-white"
        >
          + EPS 7h15-11h10 / 15h25-17h15
        </button>
      </div>

      {rules.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm font-semibold text-slate-500">
          Aucune règle établissement n’est active. Le moteur utilise seulement les règles terrain générales.
        </div>
      ) : null}

      <div className="space-y-4">
        {rules.map((rule, index) => (
          <div key={rule.id} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex flex-1 items-start gap-3">
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  onChange={(event) => updateRule(rule.id, { enabled: event.target.checked })}
                  className="mt-3 h-5 w-5 rounded border-slate-300 text-emerald-600"
                />
                <div className="grid flex-1 gap-3 lg:grid-cols-[1.4fr_1fr]">
                  <label className="block">
                    <span className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Nom de la règle #{index + 1}</span>
                    <input
                      value={rule.name}
                      onChange={(event) => updateRule(rule.id, { name: event.target.value })}
                      className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-900 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Description courte</span>
                    <input
                      value={rule.description || ""}
                      onChange={(event) => updateRule(rule.id, { description: event.target.value })}
                      className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-900 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
                    />
                  </label>
                </div>
              </div>
              <button
                type="button"
                onClick={() => removeRule(rule.id)}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-red-200 bg-white px-4 py-3 text-sm font-black text-red-700 hover:bg-red-50"
              >
                <Trash2 className="h-4 w-4" />
                Retirer
              </button>
            </div>

            <div className="grid gap-3 lg:grid-cols-4">
              <SelectField
                label="Action moteur"
                value={rule.behavior}
                onChange={(value) => updateRule(rule.id, { behavior: value })}
                options={[
                  { value: "prefer", label: "Favoriser" },
                  { value: "avoid", label: "Éviter" },
                  { value: "require", label: "Imposer" },
                  { value: "forbid", label: "Interdire" },
                ]}
              />
              <SelectField
                label="Priorité"
                value={rule.priority}
                onChange={(value) => updateRule(rule.id, { priority: value })}
                options={[
                  { value: "hard", label: "Obligatoire" },
                  { value: "strong", label: "Forte" },
                  { value: "medium", label: "Moyenne" },
                  { value: "soft", label: "Souple" },
                ]}
              />
              <SelectField
                label="Cible"
                value={rule.scope}
                onChange={(value) => updateRule(rule.id, { scope: value })}
                options={[
                  { value: "all", label: "Toute l’école" },
                  { value: "level", label: "Niveaux" },
                  { value: "class", label: "Classes" },
                  { value: "subject", label: "Matière" },
                  { value: "teacher", label: "Enseignant" },
                ]}
              />
              <label className="block">
                <span className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Créneaux n°</span>
                <input
                  value={numberListToCsv(rule.periodIndexes)}
                  placeholder="ex: 1, 2"
                  onChange={(event) => updateRule(rule.id, { periodIndexes: numberCsvToList(event.target.value) })}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-900 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
                />
              </label>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-3">
              <div>
                <span className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Jours</span>
                <div className="mt-2 flex flex-wrap gap-2">
                  {DAYS.map((day) => (
                    <label key={day.value} className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700">
                      <input
                        type="checkbox"
                        checked={rule.dayIndexes.includes(day.value)}
                        onChange={(event) => updateRule(rule.id, { dayIndexes: toggleValue(rule.dayIndexes, day.value, event.target.checked).sort((a, b) => a - b) })}
                        className="h-4 w-4 rounded border-slate-300 text-emerald-600"
                      />
                      {day.label}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <span className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Demi-journées</span>
                <div className="mt-2 flex flex-wrap gap-2">
                  {HALF_DAY_OPTIONS.map((item) => (
                    <label key={item.value} className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700">
                      <input
                        type="checkbox"
                        checked={rule.halfDays.includes(item.value)}
                        onChange={(event) => updateRule(rule.id, { halfDays: toggleValue(rule.halfDays, item.value, event.target.checked) })}
                        className="h-4 w-4 rounded border-slate-300 text-emerald-600"
                      />
                      {item.label}
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Début</span>
                  <input
                    type="time"
                    value={rule.startTime || ""}
                    onChange={(event) => updateRule(rule.id, { startTime: event.target.value || null })}
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-900 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Fin</span>
                  <input
                    type="time"
                    value={rule.endTime || ""}
                    onChange={(event) => updateRule(rule.id, { endTime: event.target.value || null })}
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-900 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
                  />
                </label>
              </div>
            </div>

            {rule.scope === "class" ? (
              <div className="mt-4 rounded-3xl border border-slate-200 bg-white p-4">
                <p className="mb-3 text-sm font-black text-slate-700">Classes ciblées</p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {classes.map((schoolClass) => (
                    <label key={schoolClass.id} className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700">
                      <input
                        type="checkbox"
                        checked={rule.classIds.includes(schoolClass.id)}
                        onChange={(event) => updateRule(rule.id, { classIds: toggleValue(rule.classIds, schoolClass.id, event.target.checked) })}
                        className="h-4 w-4 rounded border-slate-300 text-emerald-600"
                      />
                      {schoolClass.label}
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

            {rule.scope === "level" ? (
              <label className="mt-4 block">
                <span className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Niveaux ciblés</span>
                <input
                  value={listToCsv(rule.levelCodes)}
                  placeholder="ex: 3e, terminale, tle"
                  onChange={(event) => updateRule(rule.id, { levelCodes: csvToList(event.target.value) })}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-900 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
                />
              </label>
            ) : null}

            {rule.scope === "subject" ? (
              <label className="mt-4 block">
                <span className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Matières ciblées</span>
                <input
                  value={listToCsv(rule.subjectIds)}
                  placeholder="ex: eps, mathématiques, pc"
                  onChange={(event) => updateRule(rule.id, { subjectIds: csvToList(event.target.value) })}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-900 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
                />
              </label>
            ) : null}

            {rule.scope === "teacher" ? (
              <label className="mt-4 block">
                <span className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">IDs enseignants ciblés</span>
                <input
                  value={listToCsv(rule.teacherIds)}
                  placeholder="IDs séparés par virgule si besoin"
                  onChange={(event) => updateRule(rule.id, { teacherIds: csvToList(event.target.value) })}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-900 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
                />
              </label>
            ) : null}
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => addRule()}
        className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white hover:bg-slate-800"
      >
        <Plus className="h-4 w-4" />
        Ajouter une règle libre
      </button>
    </RuleBlock>
  );
}

export default function MontageTerrainRulesPage() {
  const [rules, setRules] = React.useState<Rules | null>(null);
  const [classes, setClasses] = React.useState<ClassOption[]>([]);
  const [stats, setStats] = React.useState<Stats>({ classes: 0, pc_labs: 0, svt_labs: 0, sports_fields: 0, computer_labs: 0 });
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
      if (!json) {
        setError("Réponse serveur invalide.");
        return;
      }
      if (!json.ok) {
        setError(json.message || json.error);
        return;
      }
      setRules(json.rules);
      setClasses(Array.isArray(json.classes) ? json.classes : []);
      setStats(json.stats || { classes: 0, pc_labs: 0, svt_labs: 0, sports_fields: 0, computer_labs: 0 });
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
    setRules((current) => {
      if (!current) return current;
      const next = { ...current, ...patchValue };
      if (!next.enablePcSvtTandem) {
        next.pcSvtTandemScope = "disabled";
        next.pcSvtTandemClassIds = [];
      } else if (next.pcSvtTandemScope === "disabled") {
        next.pcSvtTandemScope = "all_classes";
      }
      return next;
    });
    setSuccess(null);
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
      if (!json) {
        setError("Réponse serveur invalide pendant la sauvegarde.");
        return;
      }
      if (!json.ok) {
        setError(json.message || json.error);
        return;
      }
      setRules(json.rules);
      setSuccess(json.message || "Règles terrain sauvegardées.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de sauvegarder les règles terrain.");
    } finally {
      setSaving(false);
    }
  }

  const epsCapacity = Math.max(0, stats.sports_fields * (rules?.epsMaxSimultaneousCoursesPerField || 0));

  return (
    <MontageSectionShell
      title="Règles terrain"
      description="Adapter le moteur HoraClasse aux réalités de l’établissement sans recréer les données Mon Cahier."
      status="HoraClasse"
      note="Les règles sont stockées dans montage_timetable_terrain_rules. Elles guident la génération, mais ne publient rien automatiquement."
      cards={[
        { title: "Tandem P.C / SVT", description: "Option parallèle ou rotation, applicable à toutes les classes ou à une sélection." },
        { title: "EPS & ressources", description: "Capacité terrain EPS et secours salle ordinaire pour les matières spécialisées." },
        { title: "Qualité du montage", description: "Trous, retours inutiles, matières lourdes, blocs, reprises séparées." },
      ]}
    >
      <div className="mb-6 grid gap-4 md:grid-cols-5">
        <StatCard label="Classes" value={stats.classes} icon={School} />
        <StatCard label="Labo P.C" value={stats.pc_labs} icon={FlaskConical} />
        <StatCard label="Labo SVT" value={stats.svt_labs} icon={FlaskConical} />
        <StatCard label="Terrain EPS" value={stats.sports_fields} icon={Dumbbell} />
        <StatCard label="Salle info" value={stats.computer_labs} icon={Monitor} />
      </div>

      <div className="mb-6 rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-black text-slate-950">Paramètres du moteur</h2>
            <p className="mt-1 text-sm text-slate-500">Même logique que HoraClasse autonome, adaptée aux données officielles de Mon Cahier.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading || saving}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Recharger
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={!rules || saving}
              className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-black text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Sauvegarder
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-5 rounded-3xl border border-red-200 bg-red-50 p-5 text-red-950">
            <div className="flex gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5" />
              <div>
                <p className="font-black">Erreur</p>
                <p className="text-sm">{error}</p>
              </div>
            </div>
          </div>
        )}

        {success && (
          <div className="mt-5 rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950">
            <div className="flex gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5" />
              <div>
                <p className="font-black">Sauvegarde effectuée</p>
                <p className="text-sm">{success}</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {loading && !rules ? (
        <div className="rounded-[28px] border border-slate-200 bg-white p-10 text-center text-slate-500 shadow-sm">
          <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin" />
          Chargement des règles terrain...
        </div>
      ) : null}

      {rules ? (
        <div className="space-y-6">
          <RuleBlock
            title="Tandem P.C / SVT"
            description="À activer seulement si l’établissement fonctionne avec un montage sciences coordonné."
          >
            <div className="grid gap-4 lg:grid-cols-2">
              <ToggleCard
                title="Activer l’option tandem P.C / SVT"
                description="HoraClasse placera P.C et SVT en demi-groupes, selon le mode choisi."
                checked={rules.enablePcSvtTandem}
                onChange={(checked) => patch({ enablePcSvtTandem: checked })}
              />
              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                <strong className="block text-slate-900">Rappel</strong>
                Le tandem utilise les classes et matières déjà existantes dans Mon Cahier. Il ne crée pas de P.C, SVT, classes ou enseignants.
              </div>
            </div>

            {rules.enablePcSvtTandem && (
              <div className="mt-5 grid gap-4 lg:grid-cols-2">
                <SelectField
                  label="Portée"
                  value={rules.pcSvtTandemScope}
                  onChange={(value) => patch({ pcSvtTandemScope: value })}
                  options={[
                    { value: "all_classes", label: "Toutes les classes concernées" },
                    { value: "selected_classes", label: "Seulement certaines classes" },
                  ]}
                />
                <SelectField
                  label="Mode"
                  value={rules.pcSvtTandemMode}
                  onChange={(value) => patch({ pcSvtTandemMode: value })}
                  options={[
                    { value: "parallel", label: "ACE parallèle : P.C/SVT au même moment" },
                    { value: "rotation", label: "Rotation complète : phases successives" },
                  ]}
                />
              </div>
            )}

            {rules.enablePcSvtTandem && rules.pcSvtTandemScope === "selected_classes" && (
              <div className="mt-5 rounded-3xl border border-slate-200 bg-slate-50 p-4">
                <p className="mb-3 text-sm font-black text-slate-700">Classes concernées</p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {classes.map((schoolClass) => {
                    const checked = rules.pcSvtTandemClassIds.includes(schoolClass.id);
                    return (
                      <label
                        key={schoolClass.id}
                        className={`flex items-center gap-2 rounded-2xl border px-3 py-2 text-sm font-bold ${checked ? "border-emerald-200 bg-white text-emerald-800" : "border-slate-200 bg-white text-slate-700"}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => {
                            const nextIds = event.target.checked
                              ? [...rules.pcSvtTandemClassIds, schoolClass.id]
                              : rules.pcSvtTandemClassIds.filter((id) => id !== schoolClass.id);
                            patch({ pcSvtTandemClassIds: nextIds });
                          }}
                          className="h-4 w-4 rounded border-slate-300 text-emerald-600"
                        />
                        {schoolClass.label}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </RuleBlock>

          <RuleBlock
            title="EPS et ressources spécialisées"
            description="Le moteur utilise les salles/terrains déclarés dans l’écran Salles & ressources."
          >
            <div className="grid gap-4 lg:grid-cols-3">
              <SelectField
                label="Traitement EPS"
                value={rules.epsHotHourMode}
                onChange={(value) => patch({ epsHotHourMode: value })}
                options={[
                  { value: "strict", label: "Strict : éviter fortement les heures chaudes" },
                  { value: "soft", label: "Souple : pénaliser seulement" },
                  { value: "disabled", label: "Désactivé" },
                ]}
              />
              <label className="block">
                <span className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Capacité par terrain</span>
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={rules.epsMaxSimultaneousCoursesPerField}
                  onChange={(event) => patch({ epsMaxSimultaneousCoursesPerField: Math.max(1, Math.min(8, Number(event.target.value) || 1)) })}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-900 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
                />
              </label>
              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-semibold text-slate-500">Capacité EPS totale</p>
                <p className="mt-2 text-3xl font-black text-slate-950">{epsCapacity}</p>
                <p className="text-sm text-slate-500">{stats.sports_fields} terrain(s) × {rules.epsMaxSimultaneousCoursesPerField}</p>
              </div>
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <ToggleCard
                title="Terrain EPS comme ressource partagée"
                description="Plusieurs classes peuvent utiliser le même terrain selon la capacité définie."
                checked={rules.treatSportsFieldAsSharedResource}
                onChange={(checked) => patch({ treatSportsFieldAsSharedResource: checked })}
              />
              <ToggleCard
                title="Préférer la salle principale de la classe"
                description="Quand c’est possible, HoraClasse garde la classe dans sa salle habituelle."
                checked={rules.preferMainClassRoom}
                onChange={(checked) => patch({ preferMainClassRoom: checked })}
              />
            </div>
          </RuleBlock>

          <RuleBlock
            title="Fallback en salle ordinaire"
            description="La ressource spécialisée reste prioritaire. La salle ordinaire est seulement un secours."
          >
            <div className="grid gap-4 lg:grid-cols-2">
              <ToggleCard
                title="P.C en salle ordinaire si labo absent ou saturé"
                description="Le labo P.C reste prioritaire."
                checked={rules.allowPcInOrdinaryRoomWhenNoLab}
                onChange={(checked) => patch({ allowPcInOrdinaryRoomWhenNoLab: checked })}
              />
              <ToggleCard
                title="SVT en salle ordinaire si labo absent ou saturé"
                description="Le labo SVT reste prioritaire."
                checked={rules.allowSvtInOrdinaryRoomWhenNoLab}
                onChange={(checked) => patch({ allowSvtInOrdinaryRoomWhenNoLab: checked })}
              />
              <ToggleCard
                title="EPS en salle ordinaire si terrain absent"
                description="À garder exceptionnel, selon la réalité de l’établissement."
                checked={rules.allowEpsInOrdinaryRoomWhenNoField}
                onChange={(checked) => patch({ allowEpsInOrdinaryRoomWhenNoField: checked })}
              />
              <ToggleCard
                title="Informatique en salle ordinaire si aucune salle info"
                description="La salle informatique reste prioritaire si elle existe."
                checked={rules.allowComputerInOrdinaryRoomWhenNoLab}
                onChange={(checked) => patch({ allowComputerInOrdinaryRoomWhenNoLab: checked })}
              />
            </div>
          </RuleBlock>

          <InstitutionRulesEditor
            rules={rules.institutionRules || []}
            classes={classes}
            onChange={(institutionRules) => patch({ institutionRules })}
          />

          <RuleBlock
            title="Qualité du montage"
            description="Ces règles ne bloquent pas toujours le montage ; elles orientent le moteur vers les meilleurs placements."
          >
            <div className="grid gap-4 lg:grid-cols-2">
              <ToggleCard
                title="Ne jamais couper un bloc par la récréation"
                description="Un bloc de 2h ou plus ne traverse pas une pause."
                checked={rules.avoidBreakInsideMultiPeriodBlock}
                onChange={(checked) => patch({ avoidBreakInsideMultiPeriodBlock: checked })}
              />
              <ToggleCard
                title="Éviter les heures creuses élèves"
                description="Le moteur limite les trous dans la journée des classes."
                checked={rules.avoidStudentGaps}
                onChange={(checked) => patch({ avoidStudentGaps: checked })}
              />
              <ToggleCard
                title="Éviter les heures creuses professeurs"
                description="Le moteur cherche aussi des journées cohérentes pour les enseignants."
                checked={rules.avoidTeacherGaps}
                onChange={(checked) => patch({ avoidTeacherGaps: checked })}
              />
              <ToggleCard
                title="Éviter le retour pour 1h seulement"
                description="Une classe ne doit pas revenir juste pour une heure quand c’est évitable."
                checked={rules.avoidSingleHourReturn}
                onChange={(checked) => patch({ avoidSingleHourReturn: checked })}
              />
              <ToggleCard
                title="Éviter deux matières lourdes successives"
                description="Maths, Français, H-G et sciences sont espacés si possible."
                checked={rules.avoidHeavySubjectsBackToBack}
                onChange={(checked) => patch({ avoidHeavySubjectsBackToBack: checked })}
              />
              <ToggleCard
                title="Éviter une reprise séparée de la même matière"
                description="Deux heures consécutives sont autorisées. Ce qui est évité : 1h, puis d’autres matières, puis encore 1h plus tard le même jour."
                checked={rules.avoidSameSubjectSameDay}
                onChange={(checked) => patch({ avoidSameSubjectSameDay: checked })}
              />
              <ToggleCard
                title="Équilibrer les demi-journées"
                description="Le moteur évite les demi-journées trop chargées quand c’est possible."
                checked={rules.balanceHalfDays}
                onChange={(checked) => patch({ balanceHalfDays: checked })}
              />
            </div>
          </RuleBlock>

          <div className="rounded-[28px] border border-amber-200 bg-amber-50 p-5 text-amber-950">
            <div className="flex gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5" />
              <div>
                <p className="font-black">Règle validée</p>
                <p className="text-sm">
                  Une même matière peut faire 2h consécutives. La pénalité concerne seulement les reprises séparées dans la journée.
                </p>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-black text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gauge className="h-4 w-4" />}
              Appliquer les règles terrain
            </button>
          </div>
        </div>
      ) : null}
    </MontageSectionShell>
  );
}

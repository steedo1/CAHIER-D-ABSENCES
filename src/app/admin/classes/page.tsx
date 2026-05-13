// src/app/admin/classes/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

type OfficialTrackCode =
  | "6eme"
  | "5eme"
  | "4eme"
  | "3eme"
  | "2ndeA"
  | "2ndeC"
  | "1ereA1"
  | "1ereA2"
  | "1ereC"
  | "1ereD"
  | "tleA1"
  | "tleA2"
  | "tleC"
  | "tleD";

type ClassRow = {
  id: string;
  name: string;
  level: string;
  academic_year?: string | null;
  official_track_code?: OfficialTrackCode | null;
  class_phone_e164?: string | null;
};

type AcademicYearRow = {
  id: string;
  code: string;
  label: string;
  start_date?: string | null;
  end_date?: string | null;
  is_current: boolean;
};

const OFFICIAL_TRACK_OPTIONS: { value: OfficialTrackCode; label: string }[] = [
  { value: "6eme", label: "6ème" },
  { value: "5eme", label: "5ème" },
  { value: "4eme", label: "4ème" },
  { value: "3eme", label: "3ème" },
  { value: "2ndeA", label: "2nde A" },
  { value: "2ndeC", label: "2nde C" },
  { value: "1ereA1", label: "1ère A1" },
  { value: "1ereA2", label: "1ère A2" },
  { value: "1ereC", label: "1ère C" },
  { value: "1ereD", label: "1ère D" },
  { value: "tleA1", label: "Terminale A1" },
  { value: "tleA2", label: "Terminale A2" },
  { value: "tleC", label: "Terminale C" },
  { value: "tleD", label: "Terminale D" },
];

function Input(p: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={"w-full rounded-lg border px-3 py-2 text-sm " + (p.className ?? "")} />;
}

function Select(p: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...p} className={"w-full rounded-lg border bg-white px-3 py-2 text-sm " + (p.className ?? "")} />;
}

function Button(p: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...p}
      className={
        "rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow " +
        (p.disabled ? "cursor-not-allowed opacity-60" : "transition hover:bg-emerald-700")
      }
    />
  );
}

function IconButton({
  title,
  onClick,
  children,
  disabled,
}: {
  title: string;
  onClick: () => void;
  children: any;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={
        "inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-medium " +
        (disabled ? "cursor-not-allowed opacity-50" : "hover:bg-slate-50")
      }
    >
      {children}
    </button>
  );
}

function Modal({
  open,
  title,
  children,
  onClose,
  actions,
}: {
  open: boolean;
  title: string;
  children: any;
  onClose: () => void;
  actions?: any;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="text-sm font-semibold">{title}</div>
          <button onClick={onClose} className="text-lg leading-none text-slate-400 hover:text-slate-600">
            ×
          </button>
        </div>
        <div className="p-4">{children}</div>
        <div className="flex items-center justify-end gap-2 border-t px-4 py-3">{actions}</div>
      </div>
    </div>
  );
}

function normalizeKey(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function inferOfficialTrackCode(level: string): OfficialTrackCode | "" {
  const key = normalizeKey(level);

  if (/^6/.test(key)) return "6eme";
  if (/^5/.test(key)) return "5eme";
  if (/^4/.test(key)) return "4eme";
  if (/^3/.test(key)) return "3eme";

  if (/^(2NDEA|SECONDEA|2A)/.test(key)) return "2ndeA";
  if (/^(2NDEC|SECONDEC|2C)/.test(key)) return "2ndeC";

  if (/^(1ERED|PREMIERED|1D)/.test(key)) return "1ereD";
  if (/^(1EREC|PREMIEREC|1C)/.test(key)) return "1ereC";
  if (/^(1EREA|PREMIEREA|1A)/.test(key)) return "1ereA2";

  if (/^(TLED|TERMINALED|TD)/.test(key)) return "tleD";
  if (/^(TLEC|TERMINALEC|TC)/.test(key)) return "tleC";
  if (/^(TLEA|TERMINALEA|TA)/.test(key)) return "tleA2";

  return "";
}

function officialTrackLabel(code?: string | null) {
  return OFFICIAL_TRACK_OPTIONS.find((option) => option.value === code)?.label || "À compléter";
}

function isPremiereA(level: string) {
  const key = normalizeKey(level);
  return /^(1EREA|PREMIEREA|1A)/.test(key);
}

function isTerminaleA(level: string) {
  const key = normalizeKey(level);
  return /^(TLEA|TERMINALEA|TA)/.test(key);
}

function isSeriesA(level: string) {
  return isPremiereA(level) || isTerminaleA(level);
}

function computeOfficialTrackForGeneratedClass(level: string, isOfficialA1: boolean): OfficialTrackCode | "" {
  if (isPremiereA(level)) return isOfficialA1 ? "1ereA1" : "1ereA2";
  if (isTerminaleA(level)) return isOfficialA1 ? "tleA1" : "tleA2";
  return inferOfficialTrackCode(level);
}

function academicYearOptionLabel(row: AcademicYearRow) {
  const label = row.label || `Année scolaire ${row.code}`;
  return row.is_current ? `${label} — courante` : label;
}

export default function ClassesPage() {
  const [academicYears, setAcademicYears] = useState<AcademicYearRow[]>([]);
  const [academicYear, setAcademicYear] = useState("");
  const [loadingAcademicYears, setLoadingAcademicYears] = useState(true);
  const [academicYearError, setAcademicYearError] = useState<string | null>(null);

  const [level, setLevel] = useState("6e");
  const [format, setFormat] = useState<"none" | "numeric" | "alpha">("numeric");
  const [count, setCount] = useState<number>(5);
  const [officialTrackCode, setOfficialTrackCode] = useState<OfficialTrackCode | "">("6eme");
  const [preview, setPreview] = useState<string[]>([]);
  const [seriesA1ByLabel, setSeriesA1ByLabel] = useState<Record<string, boolean>>({});

  const [items, setItems] = useState<ClassRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [phoneDraft, setPhoneDraft] = useState<Record<string, string>>({});
  const [savingPhoneId, setSavingPhoneId] = useState<string | null>(null);
  const [msgPhone, setMsgPhone] = useState<string | null>(null);

  const [openLevel, setOpenLevel] = useState<string | null>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [eLabel, setELabel] = useState("");
  const [eLevel, setELevel] = useState("");
  const [eAcademicYear, setEAcademicYear] = useState("");
  const [eOfficialTrackCode, setEOfficialTrackCode] = useState<OfficialTrackCode | "">("");
  const [ePhone, setEPhone] = useState("");
  const [saving, setSaving] = useState(false);

  const [delOpen, setDelOpen] = useState(false);
  const [delId, setDelId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [authErr, setAuthErr] = useState(false);

  useEffect(() => {
    loadAcademicYears();
  }, []);

  useEffect(() => {
    if (!academicYear) {
      setItems([]);
      setPhoneDraft({});
      setLoading(false);
      return;
    }

    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [academicYear]);

  useEffect(() => {
    if (format === "none") setCount(1);
  }, [format]);

  useEffect(() => {
    const inferred = inferOfficialTrackCode(level);
    setOfficialTrackCode(inferred);
  }, [level]);

  useEffect(() => {
    const inferred = inferOfficialTrackCode(eLevel);
    if (inferred && !eOfficialTrackCode) {
      setEOfficialTrackCode(inferred);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eLevel]);

  function genPreview() {
    if (!level || count < 1) {
      setPreview([]);
      setSeriesA1ByLabel({});
      return;
    }

    const p: string[] = [];
    if (format === "none") {
      p.push(level);
    } else {
      for (let i = 1; i <= count; i++) {
        p.push(format === "numeric" ? `${level}${i}` : `${level}${String.fromCharCode(64 + i)}`);
      }
    }

    setPreview(p);
    setSeriesA1ByLabel((current) => {
      const next: Record<string, boolean> = {};
      for (const label of p) next[label] = current[label] === true;
      return next;
    });
  }

  useEffect(genPreview, [level, format, count]);

  async function loadAcademicYears() {
    setLoadingAcademicYears(true);
    setAcademicYearError(null);

    try {
      const r = await fetch("/api/admin/institution/academic-years", { cache: "no-store" });

      if (r.status === 401) {
        setAuthErr(true);
        return;
      }

      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) {
        throw new Error(j?.error || "Impossible de charger les années scolaires.");
      }

      const rows: AcademicYearRow[] = (Array.isArray(j.items) ? j.items : [])
        .map((row: any, idx: number) => ({
          id: String(row.id ?? `year_${idx}`),
          code: String(row.code || "").trim(),
          label: String(row.label || "").trim() || `Année scolaire ${String(row.code || "").trim()}`,
          start_date: row.start_date ? String(row.start_date).slice(0, 10) : null,
          end_date: row.end_date ? String(row.end_date).slice(0, 10) : null,
          is_current: row.is_current === true,
        }))
        .filter((row: AcademicYearRow) => row.code);

      rows.sort((a, b) => {
        const ak = a.start_date || a.code;
        const bk = b.start_date || b.code;
        return bk.localeCompare(ak, "fr", { numeric: true });
      });

      setAcademicYears(rows);

      setAcademicYear((current) => {
        if (current && rows.some((row) => row.code === current)) return current;

        const currentYear = rows.find((row) => row.is_current);
        return currentYear?.code || rows[0]?.code || "";
      });
    } catch (e: any) {
      setAcademicYears([]);
      setAcademicYear("");
      setItems([]);
      setAcademicYearError(e?.message || "Impossible de charger les années scolaires.");
    } finally {
      setLoadingAcademicYears(false);
    }
  }

  async function refresh() {
    setLoading(true);

    try {
      const qs = new URLSearchParams({ limit: "300", academic_year: academicYear });
      const r = await fetch(`/api/admin/classes?${qs.toString()}`, { cache: "no-store" });

      if (r.status === 401) {
        setAuthErr(true);
        setItems([]);
        return;
      }

      const j = await r.json().catch(() => ({}));
      const rows: ClassRow[] = (j.items || []).map((x: any) => {
        const phone = x.class_phone_e164 ?? x.device_phone_e164 ?? null;
        return {
          id: x.id,
          name: x.name ?? x.label,
          level: x.level,
          academic_year: x.academic_year ?? null,
          official_track_code: x.official_track_code ?? x.officialTrackCode ?? null,
          class_phone_e164: phone,
        };
      });

      setItems(rows);

      const init: Record<string, string> = {};
      for (const it of rows) init[it.id] = it.class_phone_e164 ?? "";
      setPhoneDraft(init);
    } finally {
      setLoading(false);
    }
  }

  async function create() {
    if (!academicYear) {
      alert("Définissez d'abord une année scolaire dans les paramètres.");
      return;
    }

    const r = await fetch("/api/admin/classes/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        level,
        format,
        count,
        academic_year: academicYear,
        official_track_code: isSeriesA(level) ? null : officialTrackCode || null,
        official_tracks_by_label: Object.fromEntries(
          preview.map((label) => [
            label,
            computeOfficialTrackForGeneratedClass(level, seriesA1ByLabel[label] === true) || null,
          ])
        ),
      }),
    });

    if (r.status === 401) {
      setAuthErr(true);
      return;
    }

    if (!r.ok) {
      const t = await r.json().catch(() => ({}));
      if (r.status === 409) {
        alert(
          "Ces classes existent déjà pour cette année scolaire, ou une ancienne contrainte unique bloque la recréation par année."
        );
      } else {
        alert("Échec de création" + (t?.error ? ` : ${t.error}` : ""));
      }
      return;
    }

    const j = await r.json().catch(() => ({}));
    await refresh();
    setOpenLevel(level);

    const inserted = Number(j?.inserted ?? 0);
    const existing = Number(j?.existing ?? 0);
    setMsgPhone(
      inserted > 0
        ? `${inserted} classe(s) créée(s). ${existing > 0 ? `${existing} existait déjà pour cette année.` : ""}`
        : "Aucune nouvelle classe créée : elles existent déjà pour cette année scolaire."
    );
    setTimeout(() => setMsgPhone(null), 3500);
  }

  const grouped = useMemo(() => {
    const m = new Map<string, ClassRow[]>();
    for (const c of items) {
      if (!m.has(c.level)) m.set(c.level, []);
      m.get(c.level)!.push(c);
    }
    for (const [k, arr] of m) {
      arr.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      m.set(k, arr);
    }
    return m;
  }, [items]);

  useEffect(() => {
    setOpenLevel(level);
  }, [level]);

  function openEdit(row: ClassRow) {
    setEditId(row.id);
    setELabel(row.name);
    setELevel(row.level);
    setEAcademicYear(row.academic_year || academicYear);
    setEOfficialTrackCode(row.official_track_code || inferOfficialTrackCode(row.level));
    setEPhone(row.class_phone_e164 ?? "");
    setEditOpen(true);
  }

  async function saveEdit() {
    if (!editId) return;

    setSaving(true);
    setMsgPhone(null);

    const body: any = {
      label: eLabel,
      level: eLevel,
      academic_year: eAcademicYear || null,
      official_track_code: eOfficialTrackCode || null,
      class_phone: ePhone.trim() || null,
    };

    const r = await fetch(`/api/admin/classes/${editId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    setSaving(false);

    if (r.status === 401) {
      setAuthErr(true);
      return;
    }

    if (!r.ok) {
      const t = await r.json().catch(() => ({}));
      if (r.status === 409) {
        alert("Une classe avec ce libellé existe déjà pour cette année scolaire.");
      } else if (r.status === 400) {
        alert("Données invalides. Vérifiez le numéro, l'année scolaire ou la série officielle.");
      } else {
        alert("Échec de mise à jour" + (t?.error ? ` : ${t.error}` : ""));
      }
      return;
    }

    setEditOpen(false);
    setEditId(null);
    await refresh();
    setMsgPhone("Classe mise à jour.");
    setTimeout(() => setMsgPhone(null), 2000);
  }

  function openDelete(row: ClassRow) {
    setDelId(row.id);
    setDelOpen(true);
  }

  async function confirmDelete() {
    if (!delId) return;

    setDeleting(true);
    const r = await fetch(`/api/admin/classes/${delId}`, { method: "DELETE" });
    setDeleting(false);

    if (r.status === 401) {
      setAuthErr(true);
      return;
    }

    if (!r.ok) {
      const t = await r.json().catch(() => ({}));
      alert("Échec de suppression" + (t?.error ? ` : ${t.error}` : ""));
      return;
    }

    setDelOpen(false);
    setDelId(null);
    await refresh();
  }

  function setDraft(id: string, v: string) {
    setPhoneDraft((m) => ({ ...m, [id]: v }));
  }

  async function savePhone(id: string) {
    setSavingPhoneId(id);
    setMsgPhone(null);

    const body: any = { class_phone: (phoneDraft[id] || "").trim() || null };
    const r = await fetch(`/api/admin/classes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    setSavingPhoneId(null);

    if (r.status === 401) {
      setAuthErr(true);
      return;
    }

    if (!r.ok) {
      const t = await r.json().catch(() => ({}));
      if (r.status === 409) {
        alert("Ce numéro est déjà utilisé par une autre classe de votre établissement.");
      } else if (r.status === 400) {
        alert("Numéro invalide. Saisissez un local ou un international : il sera normalisé.");
      } else {
        alert("Échec de mise à jour" + (t?.error ? ` : ${t.error}` : ""));
      }
      return;
    }

    await refresh();
    setMsgPhone("Numéro enregistré.");
    setTimeout(() => setMsgPhone(null), 1500);
  }

  const selectedAcademicYear = academicYears.find((row) => row.code === academicYear) || null;
  const canCreate = !!academicYear && !loadingAcademicYears;

  if (authErr) {
    return (
      <div className="rounded-xl border bg-white p-5">
        <div className="text-sm text-slate-700">
          Votre session a expiré.{" "}
          <a className="text-emerald-700 underline" href="/login">
            Se reconnecter
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Classes</h1>
        <p className="text-slate-600">
          Créer, éditer et supprimer les classes par année scolaire. Les années viennent des paramètres de
          l'établissement. Pour la série A, cochez seulement les classes réellement A1 ; les autres restent A2 par défaut.
          La série officielle sert aux coefficients, bulletins, matrices et exports DESPS sans modifier le nom affiché.
        </p>
      </div>

      <div className="rounded-2xl border bg-white p-5">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
          <div>
            <div className="mb-1 text-xs text-slate-500">Année scolaire</div>
            <Select
              value={academicYear}
              onChange={(e) => setAcademicYear(e.target.value)}
              disabled={loadingAcademicYears || academicYears.length === 0}
            >
              {loadingAcademicYears ? (
                <option value="">Chargement…</option>
              ) : academicYears.length === 0 ? (
                <option value="">Aucune année définie</option>
              ) : (
                academicYears.map((row) => (
                  <option key={row.id} value={row.code}>
                    {academicYearOptionLabel(row)}
                  </option>
                ))
              )}
            </Select>
          </div>

          <div>
            <div className="mb-1 text-xs text-slate-500">Niveau / préfixe</div>
            <Input value={level} onChange={(e) => setLevel(e.target.value)} placeholder="6e / 1A / 1D / TA / TC" />
          </div>

          <div>
            <div className="mb-1 text-xs text-slate-500">Format</div>
            <Select value={format} onChange={(e) => setFormat(e.target.value as any)}>
              <option value="none">Aucun suffixe</option>
              <option value="numeric">Numérique (1,2,3…)</option>
              <option value="alpha">Alphanumérique (A,B,C…)</option>
            </Select>
            {format === "none" && (
              <div className="mt-1 text-[11px] text-slate-500">
                Avec « Aucun suffixe », <b>Nombre = 1</b> pour créer exactement « {level} ».
              </div>
            )}
          </div>

          <div>
            <div className="mb-1 text-xs text-slate-500">Nombre</div>
            <Input
              type="number"
              min={1}
              max={30}
              value={count}
              disabled={format === "none"}
              onChange={(e) => setCount(parseInt(e.target.value || "1", 10))}
            />
          </div>

          <div className="flex items-end">
            <Button onClick={create} disabled={!canCreate}>
              Créer
            </Button>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {academicYearError ? (
            <>{academicYearError}</>
          ) : !academicYear ? (
            <>Définissez d'abord l'année scolaire dans les paramètres avant de créer les classes.</>
          ) : isSeriesA(level) ? (
            <>
              Série A : cochez uniquement les classes qui correspondent réellement à la <b>série officielle A1</b>.
              Les classes non cochées seront rattachées à <b>A2</b> par défaut.
            </>
          ) : (
            <>
              Année active sur cet écran : <b>{selectedAcademicYear?.label || academicYear}</b>. Série officielle déduite :
              <b> {officialTrackLabel(officialTrackCode)}</b>. La liste ci-dessous s'adapte automatiquement au choix de l'année.
            </>
          )}
        </div>

        {preview.length > 0 && (
          <div className="mt-4 rounded-xl border bg-slate-50 p-3 text-sm text-slate-700">
            <div className="mb-2 font-semibold">Prévisualisation</div>

            {isSeriesA(level) ? (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {preview.map((label) => {
                  const checked = seriesA1ByLabel[label] === true;
                  const code = computeOfficialTrackForGeneratedClass(level, checked);

                  return (
                    <label
                      key={label}
                      className="flex items-center justify-between gap-3 rounded-xl border bg-white px-3 py-2 text-sm shadow-sm"
                    >
                      <span>
                        <span className="font-semibold text-slate-900">{label}</span>
                        <span className="ml-2 text-xs text-slate-500">{officialTrackLabel(code)}</span>
                      </span>
                      <span className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-slate-300"
                          checked={checked}
                          onChange={(e) =>
                            setSeriesA1ByLabel((current) => ({ ...current, [label]: e.target.checked }))
                          }
                        />
                        Série A1
                      </span>
                    </label>
                  );
                })}
              </div>
            ) : (
              <div>{preview.join(", ")}</div>
            )}
          </div>
        )}
      </div>

      <div className="rounded-2xl border bg-white p-5">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm font-semibold uppercase tracking-wide text-slate-700">Liste des classes</div>
          <div className="text-xs text-slate-500">
            Année affichée : <b>{academicYear || "—"}</b>
          </div>
        </div>

        {loading ? (
          <div className="text-sm text-slate-500">Chargement…</div>
        ) : !academicYear ? (
          <div className="text-sm text-slate-500">Choisissez une année scolaire.</div>
        ) : items.length === 0 ? (
          <div className="text-sm text-slate-500">Aucune classe pour cette année scolaire.</div>
        ) : (
          Array.from(grouped.keys())
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
            .map((lvl) => {
              const arr = grouped.get(lvl)!;
              const opened = openLevel === lvl;
              return (
                <div key={lvl} className="mb-3 overflow-hidden rounded-xl border">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between bg-slate-50 px-4 py-2 text-left hover:bg-slate-100"
                    onClick={() => setOpenLevel(opened ? null : lvl)}
                    aria-expanded={opened}
                  >
                    <span className="font-medium">{lvl}</span>
                    <span className="text-xs text-slate-500">{arr.length} classe(s)</span>
                  </button>

                  {opened && (
                    <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-2">
                      {arr.map((c) => {
                        const draft = phoneDraft[c.id] ?? c.class_phone_e164 ?? "";
                        const unchanged = (draft || "") === (c.class_phone_e164 || "");
                        return (
                          <div key={c.id} className="rounded-xl border p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="truncate font-medium">{c.name}</div>
                                <div className="text-xs text-slate-500">Niveau : {c.level}</div>
                                <div className="text-xs text-slate-500">Année : {c.academic_year || "—"}</div>
                                <div className="mt-1 text-xs text-slate-700">
                                  Série officielle : <b>{officialTrackLabel(c.official_track_code)}</b>
                                </div>

                                <div className="mt-2 text-xs text-slate-600">
                                  <span className="inline-block min-w-[140px] font-medium">Téléphone (optionnel)</span>
                                </div>
                                <div className="mt-1 flex items-center gap-2">
                                  <Input
                                    placeholder="+2250701020304"
                                    value={draft}
                                    onChange={(e) => setDraft(c.id, e.target.value)}
                                    className="w-56"
                                  />
                                  <IconButton
                                    title="Enregistrer le numéro"
                                    onClick={() => savePhone(c.id)}
                                    disabled={savingPhoneId === c.id || unchanged}
                                  >
                                    {savingPhoneId === c.id ? (
                                      <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25" />
                                        <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="4" />
                                      </svg>
                                    ) : (
                                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                        <path d="M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Zm-8 2.5 5-5L15.5 9 9 15.5 5.5 12 7 10.5l2 2Z" />
                                      </svg>
                                    )}
                                    Enregistrer
                                  </IconButton>
                                </div>
                                <div className="mt-1 text-[11px] text-slate-500">
                                  Saisissez un <i>numéro local</i> ou international. Il sera <b>normalisé automatiquement</b>.
                                </div>
                              </div>

                              <div className="flex items-start gap-2">
                                <IconButton title="Éditer" onClick={() => openEdit(c)}>
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                    <path d="M17.414 2.586a2 2 0 0 0-2.828 0L6 11.172V14h2.828l8.586-8.586a2 2 0 0 0 0-2.828z" />
                                    <path fillRule="evenodd" d="M4 16a2 2 0 0 0 2 2h8a1 1 0 1 0 0-2H6a1 1 0 0 1-1-1V5a1 1 0 1 0-2 0v10z" />
                                  </svg>
                                  Éditer
                                </IconButton>
                                <IconButton title="Supprimer" onClick={() => openDelete(c)}>
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                    <path d="M6 7a1 1 0 0 1 1 1v7a1 1 0 1 1-2 0V8a1 1 0 0 1 1-1zm4 0a1 1 0 0 1 1 1v7a1 1 0 1 1-2 0V8a1 1 0 0 1 1-1zm5-3h-3.5l-1-1h-3l-1 1H2v2h16V4z" />
                                  </svg>
                                  Supprimer
                                </IconButton>
                              </div>
                            </div>
                            {c.class_phone_e164 && (
                              <div className="mt-2 text-xs text-emerald-700">
                                Numéro en vigueur : <b>{c.class_phone_e164}</b>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
        )}
        {msgPhone && (
          <div className="mt-2 text-sm text-slate-700" aria-live="polite">
            {msgPhone}
          </div>
        )}
      </div>

      <Modal
        open={editOpen}
        title="Éditer la classe"
        onClose={() => setEditOpen(false)}
        actions={
          <>
            <button onClick={() => setEditOpen(false)} className="rounded-lg border px-3 py-1.5 text-sm">
              Annuler
            </button>
            <Button onClick={saveEdit} disabled={saving}>
              {saving ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-3">
          <div>
            <div className="mb-1 text-xs text-slate-500">Libellé</div>
            <Input value={eLabel} onChange={(e) => setELabel(e.target.value)} placeholder="ex: 1A1" />
          </div>
          <div>
            <div className="mb-1 text-xs text-slate-500">Niveau / préfixe</div>
            <Input value={eLevel} onChange={(e) => setELevel(e.target.value)} placeholder="ex: 1A / 1D / TC" />
          </div>
          <div>
            <div className="mb-1 text-xs text-slate-500">Année scolaire</div>
            <Select value={eAcademicYear} onChange={(e) => setEAcademicYear(e.target.value)}>
              <option value="">À compléter</option>
              {academicYears.map((row) => (
                <option key={row.id} value={row.code}>
                  {academicYearOptionLabel(row)}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <div className="mb-1 text-xs text-slate-500">Série officielle</div>
            <Select value={eOfficialTrackCode} onChange={(e) => setEOfficialTrackCode(e.target.value as any)}>
              <option value="">À compléter</option>
              {OFFICIAL_TRACK_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <div className="mt-1 text-[11px] text-slate-500">
              Ne change pas le nom de la classe. Sert aux coefficients, bulletins, matrices et exports DESPS.
            </div>
          </div>
          <div>
            <div className="mb-1 text-xs text-slate-500">Téléphone de la classe (optionnel)</div>
            <Input value={ePhone} onChange={(e) => setEPhone(e.target.value)} placeholder="+2250701020304" inputMode="tel" autoComplete="tel" />
            <div className="mt-1 text-[11px] text-slate-500">
              Saisissez un <i>numéro local</i> ou international. Il sera normalisé automatiquement.
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        open={delOpen}
        title="Supprimer la classe"
        onClose={() => setDelOpen(false)}
        actions={
          <>
            <button onClick={() => setDelOpen(false)} className="rounded-lg border px-3 py-1.5 text-sm">
              Annuler
            </button>
            <button
              onClick={confirmDelete}
              disabled={deleting}
              className={
                "rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white shadow " +
                (deleting ? "opacity-60" : "transition hover:bg-red-700")
              }
            >
              {deleting ? "Suppression…" : "Supprimer"}
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-700">Cette action est définitive. Confirmer la suppression ?</p>
      </Modal>
    </div>
  );
}

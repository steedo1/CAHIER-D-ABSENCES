// src/app/admin/classes/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  EDUCATION_TYPE_OPTIONS,
  getConfiguredFormations,
  type ConfiguredFormation,
  type EducationOrganizationSettings,
  type EducationType,
} from "@/lib/education-organization";

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
  education_type?: EducationType | null;
  formation_code?: string | null;
  formation_level_code?: string | null;
  class_login_identifier?: string | null;
  device_phone_e164?: string | null;
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

type EducationOrganizationApiResponse = {
  ok?: boolean;
  error?: string;
  organization?: EducationOrganizationSettings;
};

type FormationChoice = ConfiguredFormation & { id: string };

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
  const [eSimPhone, setESimPhone] = useState("");
  const [saving, setSaving] = useState(false);

  const [delOpen, setDelOpen] = useState(false);
  const [delId, setDelId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [authErr, setAuthErr] = useState(false);

  const [organizationLoading, setOrganizationLoading] = useState(true);
  const [organizationError, setOrganizationError] = useState<string | null>(null);
  const [organization, setOrganization] = useState<EducationOrganizationSettings | null>(null);
  const [classEducationType, setClassEducationType] = useState<EducationType>("general_secondary");
  const [selectedFormationId, setSelectedFormationId] = useState("");

  useEffect(() => {
    loadAcademicYears();
    void loadEducationOrganization();
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
    if (classEducationType !== "general_secondary") {
      setOfficialTrackCode("");
      return;
    }

    const inferred = inferOfficialTrackCode(level);
    setOfficialTrackCode(inferred);
  }, [classEducationType, level]);

  const enabledEducationTypes = useMemo<EducationType[]>(() => {
    const configured = organization?.educationTypes || [];
    return configured.length > 0 ? configured : ["general_secondary"];
  }, [organization]);

  const formationChoices = useMemo<FormationChoice[]>(() => {
    if (!organization) return [];
    return getConfiguredFormations(organization).map((formation) => ({
      ...formation,
      id: formation.key,
    }));
  }, [organization]);

  const formationsForCurrentType = useMemo(
    () => formationChoices.filter((item) => item.educationType === classEducationType),
    [classEducationType, formationChoices],
  );

  const selectedFormation = useMemo(
    () => formationsForCurrentType.find((item) => item.id === selectedFormationId) || null,
    [formationsForCurrentType, selectedFormationId],
  );

  const isGeneralMode = classEducationType === "general_secondary";

  useEffect(() => {
    if (!enabledEducationTypes.includes(classEducationType)) {
      setClassEducationType(enabledEducationTypes[0] || "general_secondary");
    }
  }, [classEducationType, enabledEducationTypes]);

  useEffect(() => {
    if (classEducationType === "general_secondary") {
      setSelectedFormationId("");
      if (!inferOfficialTrackCode(level)) setLevel("6e");
      return;
    }

    const nextFormation =
      formationsForCurrentType.find((item) => item.id === selectedFormationId) ||
      formationsForCurrentType[0] ||
      null;

    if (!nextFormation) {
      setSelectedFormationId("");
      return;
    }

    if (selectedFormationId !== nextFormation.id) {
      setSelectedFormationId(nextFormation.id);
    }

    const firstLevel = nextFormation.levels[0]?.value || nextFormation.shortCode || nextFormation.name;
    setLevel(firstLevel);
  }, [classEducationType, formationsForCurrentType, selectedFormationId]);

  useEffect(() => {
    if (!selectedFormation || isGeneralMode) return;
    const firstLevel = selectedFormation.levels[0]?.value || selectedFormation.shortCode || selectedFormation.name;
    setLevel(firstLevel);
  }, [isGeneralMode, selectedFormation]);

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

  async function loadEducationOrganization() {
    setOrganizationLoading(true);
    setOrganizationError(null);

    try {
      const response = await fetch("/api/admin/institution/education-organization", {
        cache: "no-store",
      });

      if (response.status === 401) {
        setAuthErr(true);
        return;
      }

      const payload = (await response.json().catch(() => ({}))) as EducationOrganizationApiResponse;
      if (!response.ok || !payload.ok || !payload.organization) {
        throw new Error(payload.error || "Impossible de charger l’organisation pédagogique.");
      }

      setOrganization(payload.organization);
      const initialType = payload.organization.educationTypes.includes("general_secondary")
        ? "general_secondary"
        : payload.organization.educationTypes[0] || "general_secondary";
      setClassEducationType(initialType);
    } catch (error: any) {
      setOrganization(null);
      setClassEducationType("general_secondary");
      setOrganizationError(error?.message || "Impossible de charger l’organisation pédagogique.");
    } finally {
      setOrganizationLoading(false);
    }
  }

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
        const identifier =
          x.class_login_identifier ?? x.class_phone_e164 ?? null;
        return {
          id: x.id,
          name: x.name ?? x.label,
          level: x.level,
          academic_year: x.academic_year ?? null,
          official_track_code: x.official_track_code ?? x.officialTrackCode ?? null,
          education_type: x.education_type ?? null,
          formation_code: x.formation_code ?? null,
          formation_level_code: x.formation_level_code ?? null,
          class_login_identifier: identifier,
          device_phone_e164: x.device_phone_e164 ?? null,
          class_phone_e164: x.class_phone_e164 ?? null,
        };
      });

      setItems(rows);

      const init: Record<string, string> = {};
      for (const it of rows) {
        init[it.id] = it.class_login_identifier ?? it.class_phone_e164 ?? "";
      }
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

    if (!isGeneralMode && !selectedFormation) {
      alert("Choisissez d’abord une formation dans Organisation pédagogique.");
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
        official_track_code: isGeneralMode && !isSeriesA(level) ? officialTrackCode || null : null,
        education_type: classEducationType,
        formation_code: isGeneralMode ? null : selectedFormation?.id || null,
        formation_level_code: isGeneralMode ? null : level,
        official_tracks_by_label: isGeneralMode
          ? Object.fromEntries(
              preview.map((label) => [
                label,
                computeOfficialTrackForGeneratedClass(level, seriesA1ByLabel[label] === true) || null,
              ]),
            )
          : {},
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
    setOpenLevel(
      buildClassGroupId(
        classEducationType,
        selectedFormation?.id || null,
        level,
      ),
    );

    const inserted = Number(j?.inserted ?? 0);
    const existing = Number(j?.existing ?? 0);
    setMsgPhone(
      inserted > 0
        ? `${inserted} classe(s) créée(s). ${existing > 0 ? `${existing} existait déjà pour cette année.` : ""}`
        : "Aucune nouvelle classe créée : elles existent déjà pour cette année scolaire."
    );
    setTimeout(() => setMsgPhone(null), 3500);
  }

  function buildClassGroupId(
    educationType: EducationType,
    formationId: string | null | undefined,
    classLevel: string,
  ) {
    return `${educationType}::${formationId || "general"}::${normalizeKey(classLevel)}`;
  }

  const grouped = useMemo(() => {
    const groups = new Map<
      string,
      {
        id: string;
        educationType: EducationType;
        educationLabel: string;
        formationLabel: string | null;
        level: string;
        items: ClassRow[];
      }
    >();

    for (const classRow of items) {
      const educationType: EducationType =
        classRow.education_type || "general_secondary";
      const formation = classRow.formation_code
        ? formationChoices.find((item) => item.id === classRow.formation_code) || null
        : null;
      const educationLabel =
        EDUCATION_TYPE_OPTIONS.find((option) => option.id === educationType)?.label ||
        "Secondaire général";
      const formationLabel = formation
        ? `${formation.diplomaLabel} — ${formation.name}`
        : null;
      const id = buildClassGroupId(educationType, formation?.id, classRow.formation_level_code || classRow.level);
      const current = groups.get(id) || {
        id,
        educationType,
        educationLabel,
        formationLabel,
        level:
          formation?.levels.find((item) => item.value === (classRow.formation_level_code || classRow.level))?.label ||
          classRow.level,
        items: [],
      };
      current.items.push(classRow);
      groups.set(id, current);
    }

    const educationOrder = new Map(
      EDUCATION_TYPE_OPTIONS.map((option, index) => [option.id, index]),
    );

    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        items: group.items.sort((a, b) =>
          a.name.localeCompare(b.name, "fr", { numeric: true }),
        ),
      }))
      .sort((a, b) => {
        const educationDiff =
          (educationOrder.get(a.educationType) ?? 99) -
          (educationOrder.get(b.educationType) ?? 99);
        if (educationDiff !== 0) return educationDiff;
        const formationDiff = String(a.formationLabel || "").localeCompare(
          String(b.formationLabel || ""),
          "fr",
        );
        if (formationDiff !== 0) return formationDiff;
        return a.level.localeCompare(b.level, "fr", { numeric: true });
      });
  }, [formationChoices, items]);

  const visibleGroups = useMemo(
    () => grouped.filter((group) => group.educationType === classEducationType),
    [classEducationType, grouped],
  );

  useEffect(() => {
    setOpenLevel(
      buildClassGroupId(
        classEducationType,
        selectedFormation?.id || null,
        level,
      ),
    );
  }, [classEducationType, level, selectedFormation?.id]);

  function openEdit(row: ClassRow) {
    setEditId(row.id);
    setELabel(row.name);
    setELevel(row.level);
    setEAcademicYear(row.academic_year || academicYear);
    setEOfficialTrackCode(
      row.education_type && row.education_type !== "general_secondary"
        ? ""
        : row.official_track_code || inferOfficialTrackCode(row.level),
    );
    setEPhone(row.class_login_identifier ?? row.class_phone_e164 ?? "");
    setESimPhone(row.device_phone_e164 ?? "");
    setEditOpen(true);
  }

  async function saveEdit() {
    if (!editId) return;

    setSaving(true);
    setMsgPhone(null);

    const body: any = {
      label: eLabel,
      academic_year: eAcademicYear || null,
      official_track_code:
        items.find((item) => item.id === editId)?.education_type &&
        items.find((item) => item.id === editId)?.education_type !== "general_secondary"
          ? null
          : eOfficialTrackCode || null,
    };
    const current = items.find((item) => item.id === editId);
    const currentIdentifier =
      current?.class_login_identifier ?? current?.class_phone_e164 ?? "";
    const currentSim = current?.device_phone_e164 ?? "";
    if (ePhone.trim() !== currentIdentifier) {
      body.class_identifier = ePhone.trim() || null;
    }
    if (eSimPhone.trim() !== currentSim) {
      body.device_phone = eSimPhone.trim() || null;
    }

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

    const body: any = {
      class_identifier: (phoneDraft[id] || "").trim() || null,
    };
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
        alert("Cet identifiant est déjà utilisé par une autre classe de votre établissement.");
      } else if (r.status === 400) {
        alert("Identifiant invalide. Utilisez au maximum 128 caractères sans caractère de contrôle.");
      } else {
        alert("Échec de mise à jour" + (t?.error ? ` : ${t.error}` : ""));
      }
      return;
    }

    await refresh();
    setMsgPhone("Identifiant enregistré.");
    setTimeout(() => setMsgPhone(null), 1500);
  }

  const selectedAcademicYear = academicYears.find((row) => row.code === academicYear) || null;
  const editingClass = items.find((item) => item.id === editId) || null;
  const editingEducationType: EducationType =
    editingClass?.education_type || "general_secondary";
  const editingEducationTypeLabel =
    EDUCATION_TYPE_OPTIONS.find((item) => item.id === editingEducationType)?.label ||
    editingEducationType;
  const editingFormation = editingClass?.formation_code
    ? formationChoices.find((item) => item.id === editingClass.formation_code) || null
    : null;
  const editingLevelLabel = editingFormation?.levels.find(
    (item) =>
      normalizeKey(item.value) ===
      normalizeKey(editingClass?.formation_level_code || editingClass?.level || ""),
  )?.label;
  const canCreate =
    !!academicYear &&
    !loadingAcademicYears &&
    !organizationLoading &&
    (isGeneralMode || Boolean(selectedFormation));

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
          Créez les classes avec le générateur actuel. Pour le secondaire général, le fonctionnement reste
          inchangé. Pour le technique, le professionnel ou le BTS, choisissez d’abord la formation puis son
          niveau ; le préfixe proposé reste modifiable avant création.
        </p>
      </div>

      <div className="rounded-2xl border bg-white p-4 shadow-sm sm:p-5">
        {organizationError ? (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {organizationError} Le mode secondaire général reste disponible.
          </div>
        ) : null}

        {enabledEducationTypes.length > 1 ? (
          <div className="mb-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Enseignement concerné
            </div>
            <div className="flex flex-wrap gap-2">
              {enabledEducationTypes.map((type) => {
                const option = EDUCATION_TYPE_OPTIONS.find((item) => item.id === type);
                const active = classEducationType === type;
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setClassEducationType(type)}
                    className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                      active
                        ? "border-sky-500 bg-sky-50 text-sky-800 ring-2 ring-sky-100"
                        : "border-slate-200 bg-white text-slate-600 hover:border-sky-300"
                    }`}
                  >
                    {option?.shortLabel ?? type}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        <div
          className={`grid grid-cols-1 gap-3 ${
            isGeneralMode ? "md:grid-cols-5" : "md:grid-cols-2 xl:grid-cols-7"
          }`}
        >
          <div className={isGeneralMode ? "" : "xl:col-span-1"}>
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

          {!isGeneralMode ? (
            <>
              <div className="md:col-span-1 xl:col-span-2">
                <div className="mb-1 text-xs text-slate-500">Formation / filière</div>
                <Select
                  value={selectedFormationId}
                  onChange={(e) => setSelectedFormationId(e.target.value)}
                  disabled={organizationLoading || formationsForCurrentType.length === 0}
                >
                  {formationsForCurrentType.length === 0 ? (
                    <option value="">Aucune formation configurée</option>
                  ) : (
                    formationsForCurrentType.map((formation) => (
                      <option key={formation.id} value={formation.id}>
                        {formation.diplomaLabel} — {formation.name}
                      </option>
                    ))
                  )}
                </Select>
              </div>

              <div className="md:col-span-1 xl:col-span-1">
                <div className="mb-1 text-xs text-slate-500">Niveau proposé</div>
                <Select
                  value={
                    selectedFormation?.levels.some((option) => option.value === level) ? level : "__custom__"
                  }
                  onChange={(e) => {
                    setLevel(e.target.value === "__custom__" ? "" : e.target.value);
                  }}
                  disabled={!selectedFormation}
                >
                  {(selectedFormation?.levels || []).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                  <option value="__custom__">Autre niveau / préfixe</option>
                </Select>
              </div>
            </>
          ) : null}

          <div className={!isGeneralMode ? "md:col-span-1 xl:col-span-1" : ""}>
            <div className="mb-1 text-xs text-slate-500">
              {isGeneralMode ? "Niveau / préfixe" : "Préfixe de classe"}
            </div>
            <Input
              value={level}
              onChange={(e) => setLevel(e.target.value)}
              placeholder={isGeneralMode ? "6e / 1A / 1D / TA / TC" : "Ex. 1BT COMPTA"}
            />
          </div>

          <div className={!isGeneralMode ? "xl:col-span-1" : ""}>
            <div className="mb-1 text-xs text-slate-500">Format</div>
            <Select value={format} onChange={(e) => setFormat(e.target.value as any)}>
              <option value="none">Aucun suffixe</option>
              <option value="numeric">Numérique (1,2,3…)</option>
              <option value="alpha">Alphabétique (A,B,C…)</option>
            </Select>
            {format === "none" ? (
              <div className="mt-1 text-[11px] text-slate-500">
                Une seule classe sera créée exactement avec le préfixe « {level} ».
              </div>
            ) : null}
          </div>

          <div className={!isGeneralMode ? "xl:col-span-1" : ""}>
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
            <>Définissez d’abord l’année scolaire dans les paramètres avant de créer les classes.</>
          ) : !isGeneralMode && !selectedFormation ? (
            <>Ajoutez d’abord une formation dans <b>Organisation pédagogique</b>.</>
          ) : isGeneralMode && isSeriesA(level) ? (
            <>
              Série A : cochez uniquement les divisions entièrement A1. Pour une classe commune A1/A2, laissez
              la classe créée normalement, puis renseignez la série de chaque élève dans <b>Liste PDF</b>.
            </>
          ) : isGeneralMode ? (
            <>
              Année active : <b>{selectedAcademicYear?.label || academicYear}</b>. Série officielle déduite :
              <b> {officialTrackLabel(officialTrackCode)}</b>.
            </>
          ) : (
            <>
              Formation : <b>{selectedFormation?.diplomaLabel} — {selectedFormation?.name}</b>. Le préfixe proposé
              reste modifiable ; aucune série générale officielle ne sera attribuée à ces classes.
            </>
          )}
        </div>

        {preview.length > 0 ? (
          <div className="mt-4 rounded-xl border bg-slate-50 p-3 text-sm text-slate-700">
            <div className="mb-2 font-semibold">Prévisualisation</div>

            {isGeneralMode && isSeriesA(level) ? (
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
              <div className="flex flex-wrap gap-2">
                {preview.map((item) => (
                  <span key={item} className="rounded-lg border bg-white px-2.5 py-1 font-medium text-slate-800">
                    {item}
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>

      <div className="rounded-2xl border bg-white p-4 shadow-sm sm:p-5">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-semibold uppercase tracking-wide text-slate-700">Liste des classes</div>
            <div className="mt-0.5 text-xs font-medium text-sky-700">
              {EDUCATION_TYPE_OPTIONS.find((option) => option.id === classEducationType)?.label ||
                "Secondaire général"}
            </div>
          </div>
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
        ) : visibleGroups.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-slate-50 px-4 py-6 text-sm text-slate-600">
            Aucune classe n’est encore rattachée à cet enseignement pour l’année sélectionnée.
          </div>
        ) : (
          visibleGroups.map((group) => {
              const lvl = group.level;
              const arr = group.items;
              const opened = openLevel === group.id;
              return (
                <div key={group.id} className="mb-3 overflow-hidden rounded-xl border">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 bg-slate-50 px-4 py-2.5 text-left hover:bg-slate-100"
                    onClick={() => setOpenLevel(opened ? null : group.id)}
                    aria-expanded={opened}
                  >
                    <span className="min-w-0">
                      <span className="block text-[11px] font-bold uppercase tracking-wide text-sky-700">
                        {group.educationLabel}
                      </span>
                      {group.formationLabel ? (
                        <span className="mt-0.5 block truncate text-xs font-medium text-slate-600">
                          {group.formationLabel}
                        </span>
                      ) : null}
                      <span className="mt-0.5 block font-semibold text-slate-900">{lvl}</span>
                    </span>
                    <span className="shrink-0 text-xs text-slate-500">{arr.length} classe(s)</span>
                  </button>

                  {opened && (
                    <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-2">
                      {arr.map((c) => {
                        const storedIdentifier =
                          c.class_login_identifier ?? c.class_phone_e164 ?? "";
                        const draft = phoneDraft[c.id] ?? storedIdentifier;
                        const unchanged = (draft || "") === storedIdentifier;
                        const detectedFormation = c.formation_code
                          ? formationChoices.find((item) => item.id === c.formation_code) || null
                          : null;
                        return (
                          <div key={c.id} className="rounded-xl border p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="truncate font-medium">{c.name}</div>
                                <div className="text-xs text-slate-500">Niveau : {c.level}</div>
                                <div className="text-xs text-slate-500">Année : {c.academic_year || "—"}</div>
                                <div className="mt-1 text-xs text-slate-700">
                                  {detectedFormation ? (
                                    <>Formation : <b>{detectedFormation.diplomaLabel} — {detectedFormation.name}</b></>
                                  ) : (
                                    <>Série officielle : <b>{officialTrackLabel(c.official_track_code)}</b></>
                                  )}
                                </div>

                                <div className="mt-2 text-xs text-slate-600">
                                  <span className="inline-block min-w-[140px] font-medium">Identifiant de la classe</span>
                                </div>
                                <div className="mt-1 flex items-center gap-2">
                                  <Input
                                    placeholder="0657 1 ou +2250701020304"
                                    value={draft}
                                    onChange={(e) => setDraft(c.id, e.target.value)}
                                    className="w-56"
                                  />
                                  <IconButton
                                    title="Enregistrer l’identifiant"
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
                                  Identifiant utilisé pour connecter l’appareil de classe. Il peut être attribué par l’établissement et conserve ses zéros.
                                </div>
                              </div>

                              <div className="flex flex-wrap items-start gap-2">
                                <a
                                  title="Exporter la liste de classe en PDF"
                                  href={`/admin/classes/liste/${c.id}?academic_year=${encodeURIComponent(c.academic_year || academicYear || "")}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                    <path d="M6 2a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7.414A2 2 0 0 0 15.414 6L12 2.586A2 2 0 0 0 10.586 2H6Zm5 1.5V6a2 2 0 0 0 2 2h2.5V16a.5.5 0 0 1-.5.5H6a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5h5Z" />
                                    <path d="M7.5 10.25h5v1.25h-5v-1.25Zm0 2.25h5v1.25h-5V12.5Z" />
                                  </svg>
                                  Liste PDF
                                </a>
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
                            {storedIdentifier && (
                              <div className="mt-2 text-xs text-emerald-700">
                                Identifiant en vigueur : <b>{storedIdentifier}</b>
                              </div>
                            )}
                            {c.device_phone_e164 && (
                              <div className="mt-1 text-xs text-slate-600">
                                Téléphone / SIM : <b>{c.device_phone_e164}</b>
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
            <Input value={eLevel} readOnly className="cursor-not-allowed bg-slate-50 text-slate-600" />
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-950">
            <div className="font-bold">Contexte pédagogique protégé</div>
            <div className="mt-1">Type : {editingEducationTypeLabel}</div>
            {editingFormation ? (
              <div>
                Formation : {editingFormation.diplomaLabel} — {editingFormation.name}
              </div>
            ) : null}
            <div>
              Niveau : {editingLevelLabel || editingClass?.formation_level_code || editingClass?.level || "—"}
            </div>
            <div className="mt-1 text-amber-800">
              Le type, la formation et le niveau ne sont pas modifiables ici afin d’éviter de désynchroniser les élèves, affectations, notes et appels.
            </div>
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
          {eOfficialTrackCode || inferOfficialTrackCode(eLevel) ? (
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
                Ne change pas le nom de la classe. En cas de classe commune A1/A2, la série peut aussi être précisée élève par élève dans la liste de classe.
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
              Cette classe utilise un niveau technique, professionnel ou local. Aucune série générale officielle n’est imposée.
            </div>
          )}
          <div>
            <div className="mb-1 text-xs text-slate-500">Identifiant de la classe</div>
            <Input value={ePhone} onChange={(e) => setEPhone(e.target.value)} placeholder="0657 1" inputMode="text" autoComplete="off" />
            <div className="mt-1 text-[11px] text-slate-500">
              Identifiant utilisé pour connecter l’appareil de classe. Il peut être attribué par l’établissement.
            </div>
          </div>
          <div>
            <div className="mb-1 text-xs text-slate-500">Téléphone / SIM (optionnel)</div>
            <Input value={eSimPhone} onChange={(e) => setESimPhone(e.target.value)} placeholder="+2250701020304" inputMode="tel" autoComplete="tel" />
            <div className="mt-1 text-[11px] text-slate-500">
              Ce champ est normalisé comme un vrai numéro de téléphone et reste distinct de l’identifiant de connexion.
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

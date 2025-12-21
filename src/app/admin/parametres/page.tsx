// src/app/admin/parametres/page.tsx
"use client";

import React, {
  useEffect,
  useMemo,
  useState,
  ChangeEvent,
} from "react";

/* =========================
   Types
========================= */
type Role =
  | "super_admin"
  | "admin"
  | "educator"
  | "teacher"
  | "parent"
  | string;

type Profile = {
  id: string;
  display_name: string | null;
  email: string | null;
  phone: string | null;
  role: Role | null;
};

type SubjectCoeffRow = {
  level: string;
  subject_id: string;
  subject_name: string;
  coeff: number;
};

type SubjectComponentRow = {
  subject_id: string;
  subject_name: string;
  component_id: string; // id en base ou temp_xxx
  component_name: string; // libellé affiché (Ortho-Grammaire, Composition, …)
  coeff: number; // coeff_in_subject
  level?: string; // niveau (6e, 5e, 4e, 3e…) → pour que chaque niveau ait ses propres sous-matières
  code?: string;
  order_index?: number;
  is_active?: boolean;
};

type EvalPeriodRow = {
  id: string;
  code: string;
  label: string;
  short_label: string;
  kind: string;
  start_date: string;
  end_date: string;
  order_index: number;
  is_active: boolean;
  weight: number; // coefficient de la période (pour la moyenne annuelle)
};

type AcademicYearRow = {
  id: string;
  code: string;
  label: string;
  start_date: string;
  end_date: string;
  is_current: boolean;
};

/* =========================
   Mini UI helpers
========================= */
function Badge({
  children,
  color = "sky",
}: {
  children: React.ReactNode;
  color?: "sky" | "violet" | "rose" | "slate";
}) {
  const map: Record<string, string> = {
    sky: "bg-sky-50 text-sky-700 border-sky-200",
    violet: "bg-violet-50 text-violet-700 border-violet-200",
    rose: "bg-rose-50 text-rose-700 border-rose-200",
    slate: "bg-slate-50 text-slate-700 border-slate-200",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${map[color]}`}
    >
      {children}
    </span>
  );
}

function Modal(props: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  if (!props.open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 px-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl">
        <div className="border-b p-4">
          <div className="text-lg font-semibold text-slate-800">
            {props.title}
          </div>
        </div>
        <div className="p-4 max-h-[70vh] overflow-auto">
          {props.children}
        </div>
        <div className="flex items-center justify-end gap-2 border-t p-3">
          {props.actions}
          <button
            onClick={props.onClose}
            className="rounded-lg border px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}

function EyeIcon(props: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={props.className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
    >
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function EyeOffIcon(props: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={props.className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
    >
      <path d="M1 1l22 22M10.6 10.6a3 3 0 1 0 4.8 4.8M9.9 4.24A10.77 10.77 0 0 1 12 4c7 0 11 8 11 8a19.91 19.91 0 0 1-5.15 5.86" />
      <path d="M6.6 6.6A19.74 19.74 0 0 0 1 12s4 7 11 7a10.76 10.76 0 0 0 3.18-.49" />
    </svg>
  );
}

/* =========================
   Toasts (feedback)
========================= */
type ToastKind = "success" | "error" | "info";
type Toast = { id: string; kind: ToastKind; text: string };

const rid = () => Math.random().toString(36).slice(2, 8);

function ToastItem({
  t,
  onClose,
}: {
  t: Toast;
  onClose: (id: string) => void;
}) {
  useEffect(() => {
    const id = setTimeout(() => onClose(t.id), 4200);
    return () => clearTimeout(id);
  }, [t.id, onClose]);
  const styles =
    t.kind === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : t.kind === "error"
      ? "border-rose-200 bg-rose-50 text-rose-900"
      : "border-slate-200 bg-white text-slate-900";
  const icon = t.kind === "success" ? "✅" : t.kind === "error" ? "⚠️" : "ℹ️";
  return (
    <div
      className={`pointer-events-auto flex items-start gap-2 rounded-xl border px-3 py-2 shadow ${styles}`}
    >
      <span className="select-none text-base leading-5">{icon}</span>
      <div className="text-sm">{t.text}</div>
      <button
        className="ml-2 rounded p-1 text-xs text-slate-500 hover:bg-black/5"
        onClick={() => onClose(t.id)}
        aria-label="Fermer"
      >
        ✕
      </button>
    </div>
  );
}

function ToastHost({
  toasts,
  onClose,
}: {
  toasts: Toast[];
  onClose: (id: string) => void;
}) {
  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[60] flex w-[min(92vw,360px)] flex-col gap-2">
      {toasts.map((t) => (
        <ToastItem key={t.id} t={t} onClose={onClose} />
      ))}
    </div>
  );
}

/* =========================
   Ligne utilisateur
========================= */
type FragmentRowProps = {
  user: Profile;
  compact: boolean;
  expanded: boolean;
  onToggle: () => void;
  onResetTemp: () => void;
  onOpenCustom: () => void;
  roleColor: (r?: Role | null) => "violet" | "sky" | "rose" | "slate";
};

function FragmentRow({
  user,
  compact,
  expanded,
  onToggle,
  onResetTemp,
  onOpenCustom,
  roleColor,
}: FragmentRowProps) {
  const label =
    user.display_name || user.email || user.phone || "Utilisateur";
  const contactLine =
    user.email && user.phone
      ? `${user.email} · ${user.phone}`
      : user.email || user.phone || "—";
  const roleLabel = user.role || "—";

  if (compact) {
    return (
      <React.Fragment>
        <tr className="align-top">
          <td className="px-3 py-2">
            <button
              type="button"
              onClick={onToggle}
              className="mb-0.5 text-[11px] text-sky-700 hover:underline"
            >
              {expanded ? "Masquer les détails" : "Voir les détails"}
            </button>
            <div className="font-medium text-slate-900">{label}</div>
            <div className="max-w-xs truncate text-[11px] text-slate-500">
              {contactLine}
            </div>
          </td>
          <td className="px-3 py-2">
            <Badge color={roleColor(user.role)}>{roleLabel}</Badge>
          </td>
          <td className="px-3 py-2 text-right">
            <div className="flex justify-end gap-1">
              <button
                type="button"
                onClick={onResetTemp}
                className="rounded-lg border px-2 py-1 text-[11px] hover:bg-slate-50"
              >
                Réinit. temporaire
              </button>
              <button
                type="button"
                onClick={onOpenCustom}
                className="rounded-lg bg-sky-700 px-2 py-1 text-[11px] font-medium text-white hover:bg-sky-800"
              >
                Mot de passe…
              </button>
            </div>
          </td>
        </tr>
        {expanded && (
          <tr className="bg-slate-50/60">
            <td
              className="px-3 py-2 text-[12px] text-slate-600"
              colSpan={3}
            >
              <div>Email : {user.email || "—"}</div>
              <div>Téléphone : {user.phone || "—"}</div>
              <div>Rôle : {roleLabel}</div>
            </td>
          </tr>
        )}
      </React.Fragment>
    );
  }

  // Mode non compact : 4 colonnes (Util, Contact, Rôle, Actions)
  return (
    <tr className="align-top">
      <td className="px-3 py-2">
        <div className="font-medium text-slate-900">{label}</div>
      </td>
      <td className="px-3 py-2">
        <div className="text-[12px] text-slate-600">{user.email || "—"}</div>
        <div className="text-[12px] text-slate-600">{user.phone || "—"}</div>
      </td>
      <td className="px-3 py-2">
        <Badge color={roleColor(user.role)}>{roleLabel}</Badge>
      </td>
      <td className="px-3 py-2 text-right">
        <div className="flex justify-end gap-1">
          <button
            type="button"
            onClick={onResetTemp}
            className="rounded-lg border px-2 py-1 text-[11px] hover:bg-slate-50"
          >
            Réinit. temporaire
          </button>
          <button
            type="button"
            onClick={onOpenCustom}
            className="rounded-lg bg-sky-700 px-2 py-1 text-[11px] font-medium text-white hover:bg-sky-800"
          >
            Mot de passe…
          </button>
        </div>
      </td>
    </tr>
  );
}

/* =========================
   Petits helpers horaires
========================= */
function timeStrToMin(t: string): number {
  const [h, m] = (t || "00:00")
    .split(":")
    .map((n) => parseInt(n, 10) || 0);
  return h * 60 + m;
}
function minToTimeStr(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Même logique que côté API : pivot en août */
function computeAcademicYearFromDate(d: Date = new Date()): string {
  const m = d.getUTCMonth() + 1; // 1..12
  const y = d.getUTCFullYear();
  return m >= 8 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

/* =========================
   Page
========================= */
export default function AdminSettingsPage() {
  /* ---------- Toast manager ---------- */
  const [toasts, setToasts] = useState<Toast[]>([]);
  const pushToast = (kind: ToastKind, text: string) =>
    setToasts((l) => [...l, { id: rid(), kind, text }]);
  const closeToast = (id: string) =>
    setToasts((l) => l.filter((t) => t.id !== id));

  /* ----- Mon mot de passe ----- */
  const [pwd1, setPwd1] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [show1, setShow1] = useState(false);
  const [show2, setShow2] = useState(false);
  const [busyMine, setBusyMine] = useState(false);
  const [msgMine, setMsgMine] = useState<string | null>(null);

  /* ----- Réinitialiser mot de passe d’un user ----- */
  const [users, setUsers] = useState<Profile[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [errUsers, setErrUsers] = useState<string | null>(null);

  // Liste repliable
  const [userListOpen, setUserListOpen] = useState(false);

  // Mode compact / détails dépliables
  const [compactUsers, setCompactUsers] = useState<boolean>(true);
  const [expandedUserIds, setExpandedUserIds] = useState<Set<string>>(
    new Set()
  );

  // Modal pour définir un mot de passe personnalisé
  const [modalOpen, setModalOpen] = useState(false);
  const [targetUser, setTargetUser] = useState<Profile | null>(null);
  const [customPwd, setCustomPwd] = useState("");
  const [customPwd2, setCustomPwd2] = useState("");
  const [busyCustom, setBusyCustom] = useState(false);
  const [customMsg, setCustomMsg] = useState<string | null>(null);
  const [showCP1, setShowCP1] = useState(false);
  const [showCP2, setShowCP2] = useState(false);

  const roleColor = (r?: Role | null): "violet" | "sky" | "rose" | "slate" =>
    r === "super_admin"
      ? "violet"
      : r === "admin"
      ? "sky"
      : r === "teacher"
      ? "rose"
      : "slate";

  const disableMine = busyMine;
  const disableCustom = busyCustom;

  /* =======================
     3) Horaires & séances + infos établissement
  ======================== */
  const [cfg, setCfg] = useState({
    tz: "Africa/Abidjan",
    auto_lateness: true,
    default_session_minutes: 60,
    institution_logo_url: "",
    institution_phone: "",
    institution_email: "",
    institution_region: "",
    institution_postal_address: "",
    institution_status: "",
    institution_head_name: "",
    institution_head_title: "",
    // champs pour entête des bulletins
    country_name: "",
    country_motto: "",
    ministry_name: "",
    institution_code: "",
  });
  const [savingCfg, setSavingCfg] = useState(false);

  type Period = {
    weekday: number;
    label: string;
    start_time: string;
    end_time: string;
  };
  const [curDay, setCurDay] = useState<number>(1); // 1=Lundi … 6=Samedi
  const [byDay, setByDay] = useState<Record<number, Period[]>>({});
  const [loadingCfg, setLoadingCfg] = useState(false);
  const [savingPeriods, setSavingPeriods] = useState(false);
  const [msgSched, setMsgSched] = useState<string | null>(null);

  // Générateur de créneaux (UI)
  const [genStart, setGenStart] = useState<string>("08:00");
  const [genEnd, setGenEnd] = useState<string>("17:00");
  const [genDuration, setGenDuration] = useState<number>(55);
  const [genGap, setGenGap] = useState<number>(5); // pause entre séances
  const [genLabelBase, setGenLabelBase] = useState<string>("Séance");
  const [genPreview, setGenPreview] = useState<Period[]>([]);
  const [genReplace, setGenReplace] = useState<boolean>(true); // remplacer ou ajouter

  /* =======================
     4) Années scolaires
  ======================== */
  const [academicYears, setAcademicYears] = useState<AcademicYearRow[]>([]);
  const [loadingAcademicYears, setLoadingAcademicYears] = useState(false);
  const [savingAcademicYears, setSavingAcademicYears] = useState(false);
  const [msgAcademicYears, setMsgAcademicYears] = useState<string | null>(
    null
  );
  const [selectedAcademicYear, setSelectedAcademicYear] =
    useState<string>("");

  /* =======================
     5) Périodes d'évaluation
  ======================== */
  const [evalPeriods, setEvalPeriods] = useState<EvalPeriodRow[]>([]);
  const [loadingEvalPeriods, setLoadingEvalPeriods] = useState(false);
  const [savingEvalPeriods, setSavingEvalPeriods] = useState(false);
  const [msgEvalPeriods, setMsgEvalPeriods] = useState<string | null>(
    null
  );

  /* =======================
     6) Coeffs disciplines + sous-matières
  ======================== */
  const [subjectCoeffs, setSubjectCoeffs] = useState<SubjectCoeffRow[]>([]);
  const [loadingCoeffs, setLoadingCoeffs] = useState(false);
  const [savingCoeffs, setSavingCoeffs] = useState(false);
  const [msgCoeffs, setMsgCoeffs] = useState<string | null>(null);
  const [selectedCoeffLevel, setSelectedCoeffLevel] = useState<string>("");

  const [subjectComponents, setSubjectComponents] = useState<
    SubjectComponentRow[]
  >([]);
  const [loadingComponents, setLoadingComponents] = useState(false);
  const [savingComponents, setSavingComponents] = useState(false);
  const [msgComponents, setMsgComponents] = useState<string | null>(null);
  const [componentsModalOpen, setComponentsModalOpen] =
    useState(false);
  const [componentsTarget, setComponentsTarget] = useState<{
    level: string;
    subject_id: string;
    subject_name: string;
  } | null>(null);

  const coeffLevels = useMemo(() => {
    const s = new Set<string>();
    for (const row of subjectCoeffs) {
      if (row.level) s.add(row.level);
    }
    return Array.from(s).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
    );
  }, [subjectCoeffs]);

  const coeffRowsForSelectedLevel = useMemo(
    () =>
      selectedCoeffLevel
        ? subjectCoeffs.filter((row) => row.level === selectedCoeffLevel)
        : [],
    [selectedCoeffLevel, subjectCoeffs]
  );

  const componentsForTarget = useMemo(
    () =>
      componentsTarget
        ? subjectComponents.filter(
            (c) =>
              c.subject_id === componentsTarget.subject_id &&
              (c.level || "") === (componentsTarget.level || "")
          )
        : [],
    [componentsTarget, subjectComponents]
  );

  const parentCoeffForTarget = useMemo(() => {
    if (!componentsTarget) return 0;
    const row = subjectCoeffs.find(
      (r) =>
        r.level === componentsTarget.level &&
        r.subject_id === componentsTarget.subject_id
    );
    return row?.coeff ?? 0;
  }, [componentsTarget, subjectCoeffs]);

  const sumComponentsForTarget = useMemo(
    () =>
      componentsForTarget.reduce(
        (sum, c) => sum + (Number(c.coeff) || 0),
        0
      ),
    [componentsForTarget]
  );

  const coeffMatchForTarget =
    !componentsTarget ||
    Math.abs(sumComponentsForTarget - parentCoeffForTarget) < 1e-6;

  // si aucun niveau sélectionné mais des niveaux disponibles → on sélectionne le 1er
  useEffect(() => {
    if (!selectedCoeffLevel && coeffLevels.length > 0) {
      setSelectedCoeffLevel(coeffLevels[0]);
    }
  }, [coeffLevels, selectedCoeffLevel]);

  /* ====== Actions : mon mot de passe ====== */
  async function changeMyPassword() {
    setMsgMine(null);
    if (!pwd1 || pwd1.length < 6) {
      const m = "Mot de passe trop court (6 caractères minimum).";
      setMsgMine(m);
      pushToast("error", m);
      return;
    }
    if (pwd1 !== pwd2) {
      const m = "La confirmation ne correspond pas.";
      setMsgMine(m);
      pushToast("error", m);
      return;
    }
    setBusyMine(true);
    try {
      const r = await fetch("/api/admin/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ new_password: pwd1 }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || "Échec de mise à jour");
      const ok = "Mot de passe mis à jour ✅";
      setMsgMine(ok);
      setPwd1("");
      setPwd2("");
      pushToast("success", ok);
    } catch (e: any) {
      const m = e?.message || "Erreur";
      setMsgMine(m);
      pushToast("error", m);
    } finally {
      setBusyMine(false);
    }
  }

  /* ====== Chargement des utilisateurs (sur déroulé) ====== */
  async function loadUsers() {
    setErrUsers(null);
    setLoadingUsers(true);
    try {
      const r = await fetch(`/api/admin/users`, { cache: "no-store" });
      const j = await r.json();
      setUsers(Array.isArray(j.items) ? j.items : []);
      pushToast(
        "info",
        `Utilisateurs chargés (${Array.isArray(j.items) ? j.items.length : 0})`
      );
    } catch (e: any) {
      const m = e?.message || "Impossible de charger les utilisateurs.";
      setErrUsers(m);
      pushToast("error", m);
    } finally {
      setLoadingUsers(false);
    }
  }

  // Charger la liste uniquement quand on déroule pour la première fois
  useEffect(() => {
    if (userListOpen && users.length === 0 && !loadingUsers) {
      loadUsers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userListOpen]);

  function toggleUserExpanded(id: string) {
    setExpandedUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /* ====== Réinit temporaire ====== */
  async function resetTemp(user: Profile) {
    if (!user?.id) return;
    if (
      !confirm(
        `Réinitialiser le mot de passe de ${
          user.display_name || user.email || user.phone
        } ?`
      )
    )
      return;
    try {
      const r = await fetch("/api/admin/users/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: user.id }), // mot de passe temporaire côté serveur
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || "Échec de réinitialisation");
      alert(
        "Mot de passe réinitialisé (temporaire). Communiquez-le à l'utilisateur."
      );
      pushToast("success", "Réinitialisation temporaire effectuée.");
    } catch (e: any) {
      const m = e?.message || "Erreur";
      alert(m);
      pushToast("error", m);
    }
  }

  /* ====== Réinit personnalisé (modal) ====== */
  function openCustom(user: Profile) {
    setTargetUser(user);
    setCustomPwd("");
    setCustomPwd2("");
    setCustomMsg(null);
    setModalOpen(true);
  }
  async function submitCustom() {
    setCustomMsg(null);
    if (!targetUser?.id) {
      const m = "Utilisateur invalide.";
      setCustomMsg(m);
      pushToast("error", m);
      return;
    }
    if (!customPwd || customPwd.length < 6) {
      const m = "Mot de passe trop court (6+).";
      setCustomMsg(m);
      pushToast("error", m);
      return;
    }
    if (customPwd !== customPwd2) {
      const m = "La confirmation ne correspond pas.";
      setCustomMsg(m);
      pushToast("error", m);
      return;
    }
    setBusyCustom(true);
    try {
      const r = await fetch("/api/admin/users/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: targetUser.id,
          new_password: customPwd,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || "Échec de réinitialisation");
      const ok = "Mot de passe mis à jour ✅";
      setCustomMsg(ok);
      pushToast("success", ok);
      setTimeout(() => setModalOpen(false), 600);
    } catch (e: any) {
      const m = e?.message || "Erreur";
      setCustomMsg(m);
      pushToast("error", m);
    } finally {
      setBusyCustom(false);
    }
  }

  /* ====== Horaires : générateur & gestion ====== */
  function buildPreview(day: number) {
    const s = timeStrToMin(genStart);
    const e = timeStrToMin(genEnd);
    if (e <= s) {
      pushToast("error", "Heure de fin ≤ heure de début.");
      setGenPreview([]);
      return;
    }
    if (genDuration <= 0) {
      pushToast("error", "Durée de séance invalide.");
      setGenPreview([]);
      return;
    }
    const step = Math.max(1, genDuration) + Math.max(0, genGap);
    let cur = s;
    let i = 1;
    const out: Period[] = [];
    while (cur + genDuration <= e) {
      const st = cur;
      const en = cur + genDuration;
      out.push({
        weekday: day,
        label: `${genLabelBase} ${i}`,
        start_time: minToTimeStr(st),
        end_time: minToTimeStr(en),
      });
      cur += step;
      i++;
      if (i > 100) break; // garde-fou
    }
    setGenPreview(out);
    pushToast("info", `Prévisualisation: ${out.length} créneau(x).`);
  }

  function applyGeneratedToDays(days: number[]) {
    if (genPreview.length === 0) {
      pushToast(
        "error",
        "Aucune prévisualisation à appliquer. Cliquez d’abord sur « Prévisualiser »."
      );
      return;
    }
    setByDay((m) => {
      const next = { ...m };
      for (const d of days) {
        const rows = genPreview.map((p) => ({ ...p, weekday: d }));
        if (genReplace) next[d] = rows;
        else next[d] = [...(next[d] || []), ...rows];
      }
      return next;
    });
    pushToast(
      "success",
      `Créneaux ${genReplace ? "remplacés" : "ajoutés"} pour ${
        days.length
      } jour(s).`
    );
  }

  // Import du logo par fichier (image → data URL stockée dans institution_logo_url)
  function handleLogoFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      pushToast("error", "Veuillez sélectionner une image (PNG, JPG, SVG…).");
      e.target.value = "";
      return;
    }

    const maxSize = 1024 * 1024; // ~1 Mo
    if (file.size > maxSize) {
      pushToast("error", "Image trop volumineuse (max. 1 Mo conseillé).");
      e.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      if (!dataUrl) {
        pushToast("error", "Impossible de lire le fichier sélectionné.");
        return;
      }
      setCfg((s) => ({
        ...s,
        institution_logo_url: dataUrl,
      }));
      pushToast(
        "success",
        "Logo importé. N'oubliez pas de cliquer sur « Enregistrer les paramètres »."
      );
    };
    reader.onerror = () => {
      pushToast("error", "Erreur lors de la lecture du fichier.");
    };
    reader.readAsDataURL(file);
  }

  async function loadInstitutionConfig() {
    setLoadingCfg(true);
    setMsgSched(null);
    try {
      const [c, p] = await Promise.all([
        fetch("/api/admin/institution/settings", {
          cache: "no-store",
        }).then((r) => r.json()),
        fetch("/api/admin/institution/periods", {
          cache: "no-store",
        }).then((r) => r.json()),
      ]);
      setCfg({
        tz: c?.tz || "Africa/Abidjan",
        auto_lateness: !!c?.auto_lateness,
        default_session_minutes: Number(c?.default_session_minutes || 60),
        institution_logo_url: c?.institution_logo_url || "",
        institution_phone: c?.institution_phone || "",
        institution_email: c?.institution_email || "",
        institution_region: c?.institution_region || "",
        institution_postal_address: c?.institution_postal_address || "",
        institution_status: c?.institution_status || "",
        institution_head_name: c?.institution_head_name || "",
        institution_head_title: c?.institution_head_title || "",
        country_name: c?.country_name || "",
        country_motto: c?.country_motto || "",
        ministry_name: c?.ministry_name || "",
        institution_code: c?.institution_code || "",
      });
      const grouped: Record<number, Period[]> = {};
      (Array.isArray(p?.periods) ? p.periods : []).forEach((row: any) => {
        const w = Number(row.weekday || 1);
        if (!grouped[w]) grouped[w] = [];
        grouped[w].push({
          weekday: w,
          label: row.label || "Séance",
          start_time: String(row.start_time || "08:00").slice(0, 5),
          end_time: String(row.end_time || "09:00").slice(0, 5),
        });
      });
      setByDay(grouped);
      pushToast("info", "Paramètres établissement chargés.");
    } catch (e: any) {
      pushToast(
        "error",
        e?.message || "Chargement des paramètres impossible."
      );
    } finally {
      setLoadingCfg(false);
    }
  }

  /* ====== Années scolaires : chargement & CRUD ====== */
  async function loadAcademicYears() {
    setLoadingAcademicYears(true);
    setMsgAcademicYears(null);
    try {
      const r = await fetch("/api/admin/institution/academic-years", {
        cache: "no-store",
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) {
        throw new Error(j?.error || "Échec chargement années scolaires");
      }
      const rows = Array.isArray(j.items) ? j.items : [];
      const mapped: AcademicYearRow[] = rows.map((row: any, idx: number) => ({
        id: String(row.id ?? `year_${idx}`),
        code: String(row.code || "").trim(),
        label: String(row.label || "").trim() || "Année scolaire",
        start_date: row.start_date
          ? String(row.start_date).slice(0, 10)
          : "",
        end_date: row.end_date ? String(row.end_date).slice(0, 10) : "",
        is_current: row.is_current === true,
      }));
      // tri par date de début, puis code
      mapped.sort((a, b) => {
        const ak = a.start_date || a.code;
        const bk = b.start_date || b.code;
        return ak.localeCompare(bk);
      });
      setAcademicYears(mapped);

      let yearToSelect = selectedAcademicYear;
      if (!yearToSelect && mapped.length > 0) {
        const current = mapped.find((y) => y.is_current);
        if (current) yearToSelect = current.code;
        else yearToSelect = mapped[mapped.length - 1].code;
      }
      if (yearToSelect) {
        setSelectedAcademicYear(yearToSelect);
        await loadEvalPeriods(yearToSelect);
      } else {
        setEvalPeriods([]);
      }

      pushToast("info", `Années scolaires chargées (${mapped.length}).`);
    } catch (e: any) {
      const m =
        e?.message || "Impossible de charger les années scolaires.";
      setMsgAcademicYears(m);
      setAcademicYears([]);
      pushToast("error", m);

      // fallback : on charge quand même les périodes selon l'année courante serveur
      await loadEvalPeriods();
    } finally {
      setLoadingAcademicYears(false);
    }
  }

  function addAcademicYear() {
    setAcademicYears((prev) => {
      const suggestion = computeAcademicYearFromDate();
      const already = prev.some((y) => y.code === suggestion);
      const code = already ? "" : suggestion;
      return [
        ...prev,
        {
          id: `temp_${rid()}`,
          code,
          label: code ? `Année scolaire ${code}` : "",
          start_date: "",
          end_date: "",
          is_current: prev.length === 0,
        },
      ];
    });
  }

  function updateAcademicYear(id: string, patch: Partial<AcademicYearRow>) {
    setAcademicYears((prev) =>
      prev.map((y) =>
        y.id === id
          ? {
              ...y,
              ...patch,
            }
          : y
      )
    );
  }

  function removeAcademicYear(id: string) {
    setAcademicYears((prev) => {
      const toRemove = prev.find((y) => y.id === id);
      const next = prev.filter((y) => y.id !== id);
      if (toRemove && toRemove.code === selectedAcademicYear) {
        const current = next.find((y) => y.is_current);
        const fallback = current || next[next.length - 1];
        setSelectedAcademicYear(fallback ? fallback.code : "");
      }
      return next;
    });
  }

  async function saveAcademicYears() {
    setSavingAcademicYears(true);
    setMsgAcademicYears(null);
    try {
      const payload = academicYears.map((y, idx) => {
        const code = (y.code || "").trim();
        const label =
          (y.label || "").trim() ||
          (code ? `Année scolaire ${code}` : `Année ${idx + 1}`);
        return {
          code,
          label,
          start_date: y.start_date || null,
          end_date: y.end_date || null,
          is_current: !!y.is_current,
        };
      });

      const r = await fetch("/api/admin/institution/academic-years", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: payload }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) {
        throw new Error(
          j?.error || "Échec enregistrement années scolaires"
        );
      }
      const ok = "Années scolaires enregistrées ✅";
      setMsgAcademicYears(ok);
      pushToast("success", ok);
      await loadAcademicYears();
    } catch (e: any) {
      const m =
        e?.message ||
        "Erreur lors de l'enregistrement des années scolaires.";
      setMsgAcademicYears(m);
      pushToast("error", m);
    } finally {
      setSavingAcademicYears(false);
    }
  }

  /* ====== Périodes d'évaluation (bulletins) : chargement & CRUD ====== */
  async function loadEvalPeriods(forAcademicYear?: string) {
    setLoadingEvalPeriods(true);
    setMsgEvalPeriods(null);
    try {
      const year = (forAcademicYear || selectedAcademicYear || "").trim();
      const params = new URLSearchParams();
      if (year) params.set("academic_year", year);

      const url =
        params.toString().length > 0
          ? `/api/admin/institution/grading-periods?${params.toString()}`
          : `/api/admin/institution/grading-periods`;

      const r = await fetch(url, {
        cache: "no-store",
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) {
        throw new Error(j?.error || "Échec chargement périodes");
      }
      const rows = Array.isArray(j.items) ? j.items : [];
      const mapped: EvalPeriodRow[] = rows.map((row: any, idx: number) => ({
        id: String(row.id ?? row.code ?? `row_${idx}`),
        code: String(row.code || "").trim(),
        label: String(row.label || "").trim() || "Période",
        short_label: String(row.short_label || row.label || "").trim(),
        kind: row.kind ? String(row.kind) : "",
        start_date: row.start_date
          ? String(row.start_date).slice(0, 10)
          : "",
        end_date: row.end_date ? String(row.end_date).slice(0, 10) : "",
        order_index: Number(row.order_index ?? idx + 1),
        is_active: row.is_active !== false,
        weight:
          typeof row.weight === "number"
            ? Number(row.weight) || 1
            : typeof row.coeff === "number"
            ? Number(row.coeff) || 1
            : 1,
      }));
      mapped.sort((a, b) => a.order_index - b.order_index);
      setEvalPeriods(mapped);

      if (
        !selectedAcademicYear &&
        typeof j.academic_year === "string" &&
        j.academic_year.trim()
      ) {
        setSelectedAcademicYear(j.academic_year.trim());
      }

      const infoYear = j.academic_year || year || "année courante";
      pushToast(
        "info",
        `Périodes d'évaluation chargées (${mapped.length}) pour ${infoYear}.`
      );
    } catch (e: any) {
      const m =
        e?.message || "Impossible de charger les périodes d'évaluation.";
      setMsgEvalPeriods(m);
      setEvalPeriods([]);
      pushToast("error", m);
    } finally {
      setLoadingEvalPeriods(false);
    }
  }

  function addEvalPeriod() {
    setEvalPeriods((prev) => {
      const nextIndex = prev.length + 1;
      return [
        ...prev,
        {
          id: rid(),
          code: "",
          label: "",
          short_label: "",
          kind: "",
          start_date: "",
          end_date: "",
          order_index: nextIndex,
          is_active: true,
          weight: 1,
        },
      ];
    });
  }

  function updateEvalPeriod(id: string, patch: Partial<EvalPeriodRow>) {
    setEvalPeriods((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...patch } : p))
    );
  }

  function moveEvalPeriod(id: string, direction: "up" | "down") {
    setEvalPeriods((prev) => {
      const idx = prev.findIndex((p) => p.id === id);
      if (idx === -1) return prev;
      const newIdx = direction === "up" ? idx - 1 : idx + 1;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const copy = prev.slice();
      const [item] = copy.splice(idx, 1);
      copy.splice(newIdx, 0, item);
      return copy;
    });
  }

  function removeEvalPeriod(id: string) {
    setEvalPeriods((prev) => prev.filter((p) => p.id !== id));
  }

  async function saveEvalPeriods() {
    setSavingEvalPeriods(true);
    setMsgEvalPeriods(null);
    try {
      const academic_year = (selectedAcademicYear || "").trim();
      if (!academic_year) {
        const msg =
          "Choisissez d'abord une année scolaire dans la section « Années scolaires ».";
        setMsgEvalPeriods(msg);
        pushToast("error", msg);
        setSavingEvalPeriods(false);
        return;
      }

      const normalized = evalPeriods.map((p, idx) => {
        const code = (p.code || `P${idx + 1}`).trim();
        const label = (p.label || `Période ${idx + 1}`).trim();
        const short_label = (p.short_label || label).trim();

        // on part de p.weight (UI) mais on envoie bien coeff à l’API
        const coeff =
          typeof p.weight === "number" && p.weight > 0
            ? Number(p.weight)
            : 1;

        return {
          id: p.id,
          code,
          label,
          short_label,
          kind: p.kind && p.kind.trim() ? p.kind.trim() : null,
          start_date: p.start_date || null,
          end_date: p.end_date || null,
          order_index: idx + 1,
          is_active: !!p.is_active,
          coeff, // champ utilisé côté API
        };
      });

      const r = await fetch("/api/admin/institution/grading-periods", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periods: normalized, academic_year }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) {
        throw new Error(j?.error || "Échec enregistrement périodes");
      }
      const ok = `Périodes d'évaluation enregistrées ✅ (${academic_year}).`;
      setMsgEvalPeriods(ok);
      pushToast("success", ok);
      await loadEvalPeriods(academic_year);
    } catch (e: any) {
      const m =
        e?.message || "Erreur lors de l'enregistrement des périodes.";
      setMsgEvalPeriods(m);
      pushToast("error", m);
    } finally {
      setSavingEvalPeriods(false);
    }
  }

  /* ====== Horaires : helpers CRUD ====== */
  function addRow(day: number) {
    setByDay((m) => {
      const list = (m[day] || []).slice();
      list.push({
        weekday: day,
        label: "Séance",
        start_time: "08:00",
        end_time: "08:55",
      });
      return { ...m, [day]: list };
    });
    pushToast("info", "Créneau ajouté (non enregistré).");
  }
  function removeRow(day: number, idx: number) {
    setByDay((m) => {
      const list = (m[day] || []).slice();
      list.splice(idx, 1);
      return { ...m, [day]: list };
    });
    pushToast("info", "Créneau supprimé (non enregistré).");
  }
  function setCell(day: number, idx: number, patch: Partial<Period>) {
    setByDay((m) => {
      const list = (m[day] || []).slice();
      const cur =
        list[idx] || {
          weekday: day,
          label: "Séance",
          start_time: "08:00",
          end_time: "08:55",
        };
      list[idx] = { ...cur, ...patch, weekday: day };
      return { ...m, [day]: list };
    });
  }

  async function saveConfig() {
    setSavingCfg(true);
    try {
      const r = await fetch("/api/admin/institution/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || "Échec mise à jour paramètres");
      const ok = "Paramètres d’établissement enregistrés ✅";
      setMsgSched(ok);
      pushToast("success", ok);
    } catch (e: any) {
      const m = e?.message || "Erreur enregistrement paramètres";
      setMsgSched(m);
      pushToast("error", m);
    } finally {
      setSavingCfg(false);
    }
  }

  async function savePeriods() {
    setSavingPeriods(true);
    setMsgSched(null);
    try {
      const all: Period[] = [];
      Object.keys(byDay).forEach((k) => {
        const d = Number(k);
        (byDay[d] || []).forEach((p) => {
          if (p.start_time && p.end_time)
            all.push({ ...p, weekday: d });
        });
      });
      const r = await fetch("/api/admin/institution/periods", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periods: all }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || "Échec enregistrement créneaux");
      const ok = `Créneaux enregistrés ✅ (${j?.inserted ?? all.length})`;
      setMsgSched(ok);
      pushToast("success", ok);
      await loadInstitutionConfig();
    } catch (e: any) {
      const m = e?.message || "Erreur enregistrement créneaux";
      setMsgSched(m);
      pushToast("error", m);
    } finally {
      setSavingPeriods(false);
    }
  }

  /* ====== Coefficients disciplines + sous-matières : chargement & sauvegarde ====== */
  async function loadSubjectCoeffs() {
    setLoadingCoeffs(true);
    setMsgCoeffs(null);
    try {
      const r = await fetch("/api/admin/institution/subject-coeffs", {
        cache: "no-store",
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) {
        throw new Error(j?.error || "Échec chargement coefficients");
      }
      const rows = Array.isArray(j.items) ? j.items : [];
      const mapped: SubjectCoeffRow[] = rows.map((row: any) => ({
        level: (row.level ?? "") ? String(row.level).trim() : "",
        subject_id: String(row.subject_id),
        subject_name: String(row.subject_name || "Matière"),
        coeff: Number(row.coeff ?? 1) || 1,
      }));
      setSubjectCoeffs(mapped);
      pushToast(
        "info",
        `Coefficients chargés (${mapped.length} entrée${
          mapped.length > 1 ? "s" : ""
        }).`
      );
    } catch (e: any) {
      const m = e?.message || "Impossible de charger les coefficients.";
      setMsgCoeffs(m);
      setSubjectCoeffs([]);
      pushToast("error", m);
    } finally {
      setLoadingCoeffs(false);
    }
  }

  async function loadSubjectComponents() {
    setLoadingComponents(true);
    setMsgComponents(null);
    try {
      const r = await fetch("/api/admin/institution/subject-components", {
        cache: "no-store",
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) {
        throw new Error(j?.error || "Échec chargement sous-matières");
      }

      const rows = Array.isArray(j.items) ? j.items : [];

      const mapped: SubjectComponentRow[] = rows.map(
        (row: any, idx: number) => {
          const level =
            row.level !== undefined && row.level !== null
              ? String(row.level).trim()
              : "";

          return {
            subject_id: String(row.subject_id),
            subject_name: String(row.subject_name || "Matière"),
            component_id: String(row.id ?? `comp_${idx}`),
            component_name: String(row.label || "Sous-matière"),
            coeff:
              Number(row.coeff_in_subject ?? row.coeff ?? 0) ||
              0,
            level, // niveau depuis l'API
            code: row.code ? String(row.code) : undefined,
            order_index: Number(row.order_index ?? idx + 1),
            is_active: row.is_active !== false,
          };
        }
      );

      setSubjectComponents(mapped);
      pushToast(
        "info",
        `Sous-matières chargées (${mapped.length} entrée${
          mapped.length > 1 ? "s" : ""
        }).`
      );
    } catch (e: any) {
      const m =
        e?.message || "Impossible de charger les sous-matières.";
      setMsgComponents(m);
      setSubjectComponents([]);
      pushToast("error", m);
    } finally {
      setLoadingComponents(false);
    }
  }

  function openComponentsEditor(sc: SubjectCoeffRow) {
    if (!sc.level || !sc.subject_id) return;
    setComponentsTarget({
      level: sc.level,
      subject_id: sc.subject_id,
      subject_name: sc.subject_name,
    });
    setMsgComponents(null);
    setComponentsModalOpen(true);
  }

  function addComponentForTarget() {
    if (!componentsTarget) return;
    setSubjectComponents((prev) => [
      ...prev,
      {
        level: componentsTarget.level,
        subject_id: componentsTarget.subject_id,
        subject_name: componentsTarget.subject_name,
        component_id: `temp_${rid()}`,
        component_name: "",
        coeff: 0,
      },
    ]);
  }

  function updateComponentRow(
    component_id: string,
    patch: Partial<SubjectComponentRow>
  ) {
    setSubjectComponents((prev) =>
      prev.map((row) =>
        row.component_id === component_id ? { ...row, ...patch } : row
      )
    );
  }

  function removeComponentRow(component_id: string) {
    setSubjectComponents((prev) =>
      prev.filter((row) => row.component_id !== component_id)
    );
  }

  // version alignée avec la route : une liste de sous-matières par (matière, niveau)
  async function saveSubjectComponents(
    arg?: boolean | React.MouseEvent<HTMLButtonElement>
  ) {
    // arg = true quand on appelle saveSubjectComponents(true) depuis le modal
    const targetOnly = typeof arg === "boolean" ? arg : false;

    setSavingComponents(true);
    setMsgComponents(null);

    try {
      // 1) Déterminer le périmètre : tout / matière + niveau ciblés
      let scope = subjectComponents;

      if (targetOnly) {
        if (!componentsTarget) {
          const msg =
            "Aucune matière sélectionnée pour les sous-matières.";
          setMsgComponents(msg);
          pushToast("error", msg);
          setSavingComponents(false);
          return;
        }
        scope = subjectComponents.filter(
          (c) =>
            c.subject_id === componentsTarget.subject_id &&
            (c.level || "") === (componentsTarget.level || "")
        );
      }

      if (scope.length === 0) {
        const msg =
          "Aucune sous-matière à enregistrer pour le périmètre sélectionné.";
        setMsgComponents(msg);
        pushToast("error", msg);
        setSavingComponents(false);
        return;
      }

      // 2) Vérifier, par (matière, niveau), que la somme des sous-coeffs est cohérente
      type SumInfo = {
        sum: number;
        subject_name: string;
        level: string;
      };

      const sums = new Map<string, SumInfo>();

      for (const c of scope) {
        const label = (c.component_name || "").trim();
        if (!label) continue;

        const lvl = (c.level || "").trim();
        const key = `${c.subject_id}::${lvl}`;

        const cleanCoeff =
          !Number.isFinite(c.coeff as any) || c.coeff < 0
            ? 0
            : Number(c.coeff.toFixed(2));

        const existing = sums.get(key);
        if (existing) {
          existing.sum += cleanCoeff;
        } else {
          sums.set(key, {
            sum: cleanCoeff,
            subject_name: c.subject_name,
            level: lvl,
          });
        }
      }

      const bad: string[] = [];

      sums.forEach((info, key) => {
        const [subjectId, lvl] = key.split("::");

        const parents = subjectCoeffs.filter(
          (r) =>
            r.subject_id === subjectId &&
            (r.level || "").trim() === lvl
        );

        // Si aucun coeff défini pour cette matière à ce niveau, on laisse passer (cas limite)
        if (parents.length === 0) return;

        for (const parentRow of parents) {
          const parentCoeff =
            !Number.isFinite(parentRow.coeff as any) ||
            parentRow.coeff < 0
              ? 0
              : Number(parentRow.coeff.toFixed(2));

          if (
            info.sum > 0 &&
            Math.abs(info.sum - parentCoeff) > 1e-6
          ) {
            bad.push(
              `${info.subject_name} (${
                info.level || parentRow.level || "niveau ?"
              }) : somme sous-matières ${info.sum} ≠ coeff matière ${parentCoeff}`
            );
          }
        }
      });

      if (bad.length > 0) {
        const msg =
          "La somme des coefficients de sous-matières doit être égale au coefficient de la matière pour chaque niveau concerné. Vérifiez : " +
          bad.join(" ; ");
        setMsgComponents(msg);
        pushToast("error", msg);
        setSavingComponents(false);
        return;
      }

      // 3) Grouper par (subject_id, level) pour appeler la route API une fois par couple
      type GroupItem = {
        label: string;
        short_label: string;
        coeff_in_subject: number;
        order_index: number;
        is_active: boolean;
      };

      type Group = {
        subject_id: string;
        subject_name: string;
        level: string;
        items: GroupItem[];
      };

      const bySubjectLevel = new Map<string, Group>();

      for (const row of scope) {
        const label = (row.component_name || "").trim();
        if (!label) continue;

        const lvl = (row.level || "").trim();
        const key = `${row.subject_id}::${lvl}`;

        const cleanCoeff =
          !Number.isFinite(row.coeff as any) || row.coeff < 0
            ? 0
            : Number(row.coeff.toFixed(2));

        if (!bySubjectLevel.has(key)) {
          bySubjectLevel.set(key, {
            subject_id: row.subject_id,
            subject_name: row.subject_name,
            level: lvl,
            items: [],
          });
        }

        const group = bySubjectLevel.get(key)!;
        const order_index = group.items.length + 1;

        group.items.push({
          label,
          short_label: label,
          coeff_in_subject: cleanCoeff,
          order_index,
          is_active: row.is_active !== false,
        });
      }

      if (bySubjectLevel.size === 0) {
        const msg =
          "Aucune sous-matière valide à enregistrer (toutes les lignes sont vides).";
        setMsgComponents(msg);
        pushToast("error", msg);
        setSavingComponents(false);
        return;
      }

      // 4) Appels API : PUT /subject-components par matière + niveau
      let totalInserted = 0;

      for (const [, group] of bySubjectLevel) {
        const res = await fetch(
          "/api/admin/institution/subject-components",
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              subject_id: group.subject_id,
              level: group.level || null,
              items: group.items,
            }),
          }
        );
        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j?.ok) {
          throw new Error(
            j?.error ||
              `Échec enregistrement sous-matières pour la matière ${group.subject_name}${
                group.level ? ` (${group.level})` : ""
              }.`
          );
        }
        if (typeof j.inserted === "number") {
          totalInserted += j.inserted;
        }
      }

      const ok =
        targetOnly && componentsTarget
          ? `Sous-matières enregistrées ✅ pour ${componentsTarget.subject_name} (${componentsTarget.level}).`
          : `Sous-matières enregistrées ✅ (${totalInserted} ligne${
              totalInserted > 1 ? "s" : ""
            }).`;

      setMsgComponents(ok);
      pushToast("success", ok);

      // On recharge pour rester synchro avec la base
      await loadSubjectComponents();
    } catch (e: any) {
      const m =
        e?.message || "Erreur lors de l'enregistrement des sous-matières.";
      setMsgComponents(m);
      pushToast("error", m);
    } finally {
      setSavingComponents(false);
    }
  }

  async function saveSubjectCoeffs() {
    setSavingCoeffs(true);
    setMsgCoeffs(null);
    try {
      const payload = subjectCoeffs.map((row) => ({
        level: row.level,
        subject_id: row.subject_id,
        coeff:
          !Number.isFinite(row.coeff as any) || row.coeff < 0
            ? 0
            : Number(row.coeff.toFixed(2)),
      }));
      const r = await fetch("/api/admin/institution/subject-coeffs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: payload }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) {
        throw new Error(j?.error || "Échec enregistrement coefficients");
      }
      const ok =
        "Coefficients de disciplines par niveau enregistrés ✅";
      setMsgCoeffs(ok);
      pushToast("success", ok);
    } catch (e: any) {
      const m =
        e?.message ||
        "Erreur lors de l'enregistrement des coefficients.";
      setMsgCoeffs(m);
      pushToast("error", m);
    } finally {
      setSavingCoeffs(false);
    }
  }

  /* ====== chargement initial ====== */
  useEffect(() => {
    loadInstitutionConfig();
    loadAcademicYears(); // charge aussi les périodes
    loadSubjectCoeffs();
    loadSubjectComponents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const disableComponentsSaveAll =
    savingComponents || loadingComponents || subjectComponents.length === 0;
  const disableCoeffsSaveAll =
    savingCoeffs || loadingCoeffs || subjectCoeffs.length === 0;

  return (
    <>
      <ToastHost toasts={toasts} onClose={closeToast} />

      <main className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
        <header className="mb-2">
          <h1 className="text-2xl font-semibold text-slate-900">
            Paramètres
          </h1>
          <p className="text-sm text-slate-600">
            Mot de passe, utilisateurs, horaires, années scolaires, périodes
            d&apos;évaluation et coefficients des disciplines par niveau.
          </p>
        </header>

        {/* =======================
            1) Mon mot de passe
        ======================== */}
        <section className="rounded-2xl border border-sky-200 bg-sky-50/50 p-5 shadow-sm">
          <div className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-700">
            Mon mot de passe
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
                <span>Nouveau mot de passe</span>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-[11px] text-sky-700 hover:underline"
                  onClick={() => setShow1((v) => !v)}
                >
                  {show1 ? (
                    <EyeOffIcon className="h-4 w-4" />
                  ) : (
                    <EyeIcon className="h-4 w-4" />
                  )}{" "}
                  {show1 ? "Masquer" : "Afficher"}
                </button>
              </div>
              <input
                type={show1 ? "text" : "password"}
                className="w-full rounded-lg border px-3 py-2 text-sm"
                value={pwd1}
                onChange={(e) => setPwd1(e.target.value)}
                disabled={disableMine}
                placeholder="••••••••"
              />
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
                <span>Confirmer</span>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-[11px] text-sky-700 hover:underline"
                  onClick={() => setShow2((v) => !v)}
                >
                  {show2 ? (
                    <EyeOffIcon className="h-4 w-4" />
                  ) : (
                    <EyeIcon className="h-4 w-4" />
                  )}{" "}
                  {show2 ? "Masquer" : "Afficher"}
                </button>
              </div>
              <input
                type={show2 ? "text" : "password"}
                className="w-full rounded-lg border px-3 py-2 text-sm"
                value={pwd2}
                onChange={(e) => setPwd2(e.target.value)}
                disabled={disableMine}
                placeholder="••••••••"
              />
            </div>

            <div className="flex items-end">
              <button
                onClick={changeMyPassword}
                disabled={disableMine}
                className="rounded-xl bg-sky-700 px-4 py-2 text-sm font-medium text-white shadow hover:bg-sky-800 disabled:opacity-60"
              >
                {busyMine ? "Mise à jour…" : "Changer mon mot de passe"}
              </button>
            </div>
          </div>

          {msgMine && (
            <div className="mt-2 text-sm text-slate-700">{msgMine}</div>
          )}
        </section>

        {/* ==========================================
            2) Réinitialiser le mot de passe d'un user
        =========================================== */}
        <section className="rounded-2xl border border-rose-200 bg-rose-50/50 p-5 shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-semibold uppercase tracking-wide text-slate-700">
              Réinitialiser le mot de passe d’un utilisateur
            </div>
            <button
              onClick={() => setUserListOpen((v) => !v)}
              className="rounded-lg border px-3 py-1.5 text-sm hover:bg-slate-50"
            >
              {userListOpen ? "Masquer la liste" : "Afficher la liste"}
            </button>
          </div>

          {userListOpen && (
            <>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <label className="inline-flex select-none items-center gap-2 rounded-lg border px-2 py-1 text-xs">
                  <input
                    type="checkbox"
                    checked={compactUsers}
                    onChange={(e) =>
                      setCompactUsers(e.target.checked)
                    }
                  />
                  Mode compact (replier les lignes)
                </label>

                <button
                  onClick={loadUsers}
                  className="rounded-lg border px-3 py-1.5 text-sm hover:bg-slate-50"
                  disabled={loadingUsers}
                  title="Rafraîchir la liste"
                >
                  {loadingUsers ? "Chargement…" : "Rafraîchir"}
                </button>
              </div>

              {errUsers && (
                <div className="mb-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {errUsers}
                </div>
              )}

              {loadingUsers ? (
                <div className="text-sm text-slate-500">
                  Chargement des utilisateurs…
                </div>
              ) : users.length === 0 ? (
                <div className="text-sm text-slate-500">
                  Aucun utilisateur trouvé.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b bg-slate-50 text-slate-600">
                        <th className="px-3 py-2 text-left">
                          Utilisateur
                        </th>
                        {!compactUsers && (
                          <th className="px-3 py-2 text-left">
                            Contact
                          </th>
                        )}
                        <th className="px-3 py-2 text-left">Rôle</th>
                        <th className="px-3 py-2 text-right">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((u) => {
                        const isOpen = expandedUserIds.has(u.id);
                        return (
                          <FragmentRow
                            key={u.id}
                            user={u}
                            compact={compactUsers}
                            expanded={isOpen}
                            onToggle={() =>
                              toggleUserExpanded(u.id)
                            }
                            onResetTemp={() => resetTemp(u)}
                            onOpenCustom={() => openCustom(u)}
                            roleColor={roleColor}
                          />
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </section>

        {/* =======================
            3) Horaires & séances + infos établissement
        ======================== */}
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold uppercase tracking-wide text-slate-700">
                Horaires & séances de l’établissement
              </div>
              <p className="text-xs text-slate-500">
                Fuseau horaire, durée de séance, créneaux journaliers et infos
                administratives (logo, ministère, téléphone…). Ces paramètres
                pilotent les retards et certains documents (bulletins, exports).
              </p>
            </div>
            <button
              onClick={loadInstitutionConfig}
              className="rounded-lg border px-3 py-1.5 text-sm hover:bg-slate-50"
              title="Rafraîchir"
            >
              Rafraîchir
            </button>
          </div>

          {/* Paramètres d’établissement (horaires) */}

          <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Réglages de séance */}
            <div className="rounded-xl border border-emerald-100 bg-white p-4">
              <div className="mb-3 text-sm font-medium text-slate-800">
                Réglages de séance
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <div className="mb-1 text-xs text-slate-500">
                Fuseau horaire
              </div>
              <select
                className="w-full rounded-lg border px-3 py-2 text-sm"
                value={cfg.tz}
                onChange={(e) =>
                  setCfg((s) => ({ ...s, tz: e.target.value }))
                }
                disabled={loadingCfg || savingCfg}
              >
                <option value="Africa/Abidjan">
                  Africa/Abidjan (UTC+0)
                </option>
                <option value="Africa/Lagos">
                  Africa/Lagos (UTC+1)
                </option>
                <option value="Africa/Dakar">
                  Africa/Dakar (UTC+0)
                </option>
                <option value="UTC">UTC</option>
              </select>
            </div>
            <div>
              <div className="mb-1 text-xs text-slate-500">
                Durée par séance (minutes)
              </div>
              <input
                type="number"
                min={1}
                className="w-full rounded-lg border px-3 py-2 text-sm"
                value={cfg.default_session_minutes}
                onChange={(e) =>
                  setCfg((s) => ({
                    ...s,
                    default_session_minutes: Math.max(
                      1,
                      parseInt(e.target.value || "60", 10)
                    ),
                  }))
                }
                disabled={loadingCfg || savingCfg}
              />
              <div className="mt-1 text-[11px] text-slate-500">
                Utilisée comme valeur par défaut lors de l’ouverture de séance
                (UI), sans forcer vos créneaux ci-dessous.
              </div>
            </div>
                
              </div>
            </div>

            {/* En-tête bulletins */}
            <div className="rounded-xl border border-emerald-100 bg-white p-4">
              <div className="mb-3 text-sm font-medium text-slate-800">
                En-tête des bulletins
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
<div>
              <div className="mb-1 text-xs text-slate-500">
                Nom du pays pour l&apos;en-tête (optionnel)
              </div>
              <input
                className="w-full rounded-lg border px-3 py-2 text-sm"
                value={cfg.country_name}
                onChange={(e) =>
                  setCfg((s) => ({
                    ...s,
                    country_name: e.target.value,
                  }))
                }
                disabled={loadingCfg || savingCfg}
                placeholder="République de Côte d&apos;Ivoire"
              />
            </div>
<div>
              <div className="mb-1 text-xs text-slate-500">
                Devise nationale (optionnel)
              </div>
              <input
                className="w-full rounded-lg border px-3 py-2 text-sm"
                value={cfg.country_motto}
                onChange={(e) =>
                  setCfg((s) => ({
                    ...s,
                    country_motto: e.target.value,
                  }))
                }
                disabled={loadingCfg || savingCfg}
                placeholder="Union - Discipline - Travail"
              />
            </div>
<div>
              <div className="mb-1 text-xs text-slate-500">
                Nom du ministère (optionnel)
              </div>
              <input
                className="w-full rounded-lg border px-3 py-2 text-sm"
                value={cfg.ministry_name}
                onChange={(e) =>
                  setCfg((s) => ({
                    ...s,
                    ministry_name: e.target.value,
                  }))
                }
                disabled={loadingCfg || savingCfg}
                placeholder="MINISTERE DE L&apos;EDUCATION NATIONALE ET DE L&apos;ALPHABETISATION"
              />
            </div>
<div>
              <div className="mb-1 text-xs text-slate-500">
                Code établissement / MEN (optionnel)
              </div>
              <input
                className="w-full rounded-lg border px-3 py-2 text-sm"
                value={cfg.institution_code}
                onChange={(e) =>
                  setCfg((s) => ({
                    ...s,
                    institution_code: e.target.value,
                  }))
                }
                disabled={loadingCfg || savingCfg}
                placeholder="Code MEN : 123456"
              />
            </div>
              </div>
              <div className="mt-2 text-[11px] text-slate-500">
                Ces champs sont optionnels et apparaissent sur les bulletins et documents (si renseignés).
              </div>
            </div>

            {/* Contacts & localisation */}
            <div className="rounded-xl border border-emerald-100 bg-white p-4">
              <div className="mb-3 text-sm font-medium text-slate-800">
                Contacts & localisation
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
<div>
              <div className="mb-1 text-xs text-slate-500">
                Téléphone de l&apos;établissement (optionnel)
              </div>
              <input
                type="tel"
                className="w-full rounded-lg border px-3 py-2 text-sm"
                value={cfg.institution_phone}
                onChange={(e) =>
                  setCfg((s) => ({
                    ...s,
                    institution_phone: e.target.value,
                  }))
                }
                disabled={loadingCfg || savingCfg}
                placeholder="+225 01 02 03 04"
              />
            </div>
<div>
              <div className="mb-1 text-xs text-slate-500">
                Email de l&apos;établissement (optionnel)
              </div>
              <input
                type="email"
                className="w-full rounded-lg border px-3 py-2 text-sm"
                value={cfg.institution_email}
                onChange={(e) =>
                  setCfg((s) => ({
                    ...s,
                    institution_email: e.target.value,
                  }))
                }
                disabled={loadingCfg || savingCfg}
                placeholder="contact@ecole.ci"
              />
            </div>
<div>
              <div className="mb-1 text-xs text-slate-500">
                Direction régionale (optionnel)
              </div>
              <input
                className="w-full rounded-lg border px-3 py-2 text-sm"
                value={cfg.institution_region}
                onChange={(e) =>
                  setCfg((s) => ({
                    ...s,
                    institution_region: e.target.value,
                  }))
                }
                disabled={loadingCfg || savingCfg}
                placeholder="DRENA Abidjan 1"
              />
            </div>
<div>
              <div className="mb-1 text-xs text-slate-500">
                Adresse postale (optionnel)
              </div>
              <input
                className="w-full rounded-lg border px-3 py-2 text-sm"
                value={cfg.institution_postal_address}
                onChange={(e) =>
                  setCfg((s) => ({
                    ...s,
                    institution_postal_address: e.target.value,
                  }))
                }
                disabled={loadingCfg || savingCfg}
                placeholder="BP 123 Abidjan"
              />
            </div>
<div>
              <div className="mb-1 text-xs text-slate-500">
                Statut de l&apos;établissement (optionnel)
              </div>
              <input
                className="w-full rounded-lg border px-3 py-2 text-sm"
                value={cfg.institution_status}
                onChange={(e) =>
                  setCfg((s) => ({
                    ...s,
                    institution_status: e.target.value,
                  }))
                }
                disabled={loadingCfg || savingCfg}
                placeholder="Public / Privé laïc / ..."
              />
            </div>
              </div>
            </div>

            {/* Direction & logo */}
            <div className="rounded-xl border border-emerald-100 bg-white p-4">
              <div className="mb-3 text-sm font-medium text-slate-800">
                Direction & logo
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
<div>
              <div className="mb-1 text-xs text-slate-500">
                Nom complet du 1er responsable (optionnel)
              </div>
              <input
                className="w-full rounded-lg border px-3 py-2 text-sm"
                value={cfg.institution_head_name}
                onChange={(e) =>
                  setCfg((s) => ({
                    ...s,
                    institution_head_name: e.target.value,
                  }))
                }
                disabled={loadingCfg || savingCfg}
                placeholder="Nom et prénom(s)"
              />
            </div>
<div>
              <div className="mb-1 text-xs text-slate-500">
                Fonction du 1er responsable (optionnel)
              </div>
              <input
                className="w-full rounded-lg border px-3 py-2 text-sm"
                value={cfg.institution_head_title}
                onChange={(e) =>
                  setCfg((s) => ({
                    ...s,
                    institution_head_title: e.target.value,
                  }))
                }
                disabled={loadingCfg || savingCfg}
                placeholder="Proviseur, Directeur, ..."
              />
            </div>
              </div>

              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
{/* Logo importé par fichier */}
            <div>
              <div className="mb-1 text-xs text-slate-500">
                Logo de l&apos;établissement (import d&apos;image)
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex cursor-pointer items-center justify-center rounded-lg border bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50">
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleLogoFileChange}
                      disabled={loadingCfg || savingCfg}
                    />
                    Choisir un fichier…
                  </label>
                  {cfg.institution_logo_url && (
                    <button
                      type="button"
                      onClick={() =>
                        setCfg((s) => ({
                          ...s,
                          institution_logo_url: "",
                        }))
                      }
                      className="rounded-lg border border-rose-300 bg-rose-50 px-2 py-1 text-[11px] font-medium text-rose-800 hover:bg-rose-100"
                      disabled={loadingCfg || savingCfg}
                    >
                      Retirer le logo
                    </button>
                  )}
                </div>

                {cfg.institution_logo_url && (
                  <div className="flex items-center gap-2">
                    <div className="h-12 w-12 overflow-hidden rounded border bg-white">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={cfg.institution_logo_url}
                        alt="Logo de l'établissement"
                        className="h-full w-full object-contain"
                      />
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Logo actuellement utilisé pour les bulletins et autres
                      documents officiels.
                    </div>
                  </div>
                )}

                <div className="text-[11px] text-slate-500">
                  Formats conseillés : PNG ou JPG, taille ≤ 1&nbsp;Mo.
                </div>
              </div>
            </div>

            <div>
              <div className="mb-1 text-xs text-slate-500">
              </div>
            </div>
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-2">
            <button
              onClick={saveConfig}
              disabled={savingCfg || loadingCfg}
              className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-60"
            >
              {savingCfg ? "Enregistrement…" : "Enregistrer les paramètres"}
            </button>
            {msgSched && (
              <span className="text-sm text-slate-700">{msgSched}</span>
            )}
          </div>

          <div className="my-4 h-px w-full bg-emerald-200/60" />

          {/* Générateur de créneaux */}
          <div className="mb-4 rounded-xl border border-emerald-100 bg-emerald-50/40 p-3">
            <div className="mb-2 text-sm font-medium text-slate-800">
              Générateur de créneaux (auto)
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-5">
              <div>
                <div className="mb-1 text-xs text-slate-500">
                  Début journée
                </div>
                <input
                  type="time"
                  value={genStart}
                  onChange={(e) => setGenStart(e.target.value)}
                  className="w-full rounded-lg border bg-white px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <div className="mb-1 text-xs text-slate-500">
                  Fin journée
                </div>
                <input
                  type="time"
                  value={genEnd}
                  onChange={(e) => setGenEnd(e.target.value)}
                  className="w-full rounded-lg border bg-white px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <div className="mb-1 text-xs text-slate-500">
                  Durée séance (min)
                </div>
                <input
                  type="number"
                  min={1}
                  value={genDuration}
                  onChange={(e) =>
                    setGenDuration(
                      Math.max(1, parseInt(e.target.value || "0", 10))
                    )
                  }
                  className="w-full rounded-lg border bg-white px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <div className="mb-1 text-xs text-slate-500">
                  Pause entre séances (min)
                </div>
                <input
                  type="number"
                  min={0}
                  value={genGap}
                  onChange={(e) =>
                    setGenGap(
                      Math.max(0, parseInt(e.target.value || "0", 10))
                    )
                  }
                  className="w-full rounded-lg border bg-white px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <div className="mb-1 text-xs text-slate-500">
                  Libellé de base
                </div>
                <input
                  value={genLabelBase}
                  onChange={(e) => setGenLabelBase(e.target.value)}
                  className="w-full rounded-lg border bg-white px-3 py-1.5 text-sm"
                  placeholder="Séance"
                />
              </div>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={genReplace}
                  onChange={(e) => setGenReplace(e.target.checked)}
                />
                Remplacer les créneaux existants (sinon, ajouter à la suite)
              </label>

              <button
                onClick={() => buildPreview(curDay)}
                className="rounded-lg border bg-white px-3 py-1.5 text-sm hover:bg-slate-100"
              >
                Prévisualiser (jour courant)
              </button>
              <button
                onClick={() => applyGeneratedToDays([curDay])}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
              >
                Appliquer au jour courant
              </button>
              <button
                onClick={() => applyGeneratedToDays([1, 2, 3, 4, 5])}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
              >
                Appliquer Lun→Ven
              </button>
            </div>

            {genPreview.length > 0 && (
              <div className="mt-3 overflow-x-auto rounded-lg border bg-white">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr className="text-left text-slate-600">
                      <th className="w-12 px-3 py-2">#</th>
                      <th className="w-36 px-3 py-2">Début</th>
                      <th className="w-36 px-3 py-2">Fin</th>
                      <th className="px-3 py-2">
                        Libellé (prévisualisation)
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {genPreview.map((p, i) => (
                      <tr key={i}>
                        <td className="px-3 py-2">{i + 1}</td>
                        <td className="px-3 py-2">{p.start_time}</td>
                        <td className="px-3 py-2">{p.end_time}</td>
                        <td className="px-3 py-2">{p.label}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-emerald-100 bg-white p-3 shadow-sm">
          {/* Onglets jours */}
          <div className="mb-2 flex flex-wrap gap-2">
            {[
              { d: 1, n: "Lun" },
              { d: 2, n: "Mar" },
              { d: 3, n: "Mer" },
              { d: 4, n: "Jeu" },
              { d: 5, n: "Ven" },
              { d: 6, n: "Sam" },
            ].map((w) => (
              <button
                key={w.d}
                onClick={() => setCurDay(w.d)}
                className={`rounded-lg border px-3 py-1.5 text-sm ${
                  curDay === w.d
                    ? "bg-emerald-700 text-white"
                    : "hover:bg-slate-50"
                }`}
              >
                {w.n}
              </button>
            ))}
          </div>

          {/* Tableau créneaux pour le jour courant */}
          <div className="overflow-x-auto rounded-xl border">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr className="text-left text-slate-600">
                  <th className="w-12 px-3 py-2">#</th>
                  <th className="w-36 px-3 py-2">Début</th>
                  <th className="w-36 px-3 py-2">Fin</th>
                  <th className="px-3 py-2">Libellé</th>
                  <th className="w-24 px-3 py-2 text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {loadingCfg ? (
                  <tr>
                    <td
                      className="px-3 py-3 text-slate-500"
                      colSpan={5}
                    >
                      Chargement…
                    </td>
                  </tr>
                ) : (byDay[curDay] || []).length === 0 ? (
                  <tr>
                    <td
                      className="px-3 py-3 text-slate-500"
                      colSpan={5}
                    >
                      Aucun créneau pour ce jour.
                    </td>
                  </tr>
                ) : (
                  (byDay[curDay] || []).map((row, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2">{i + 1}</td>
                      <td className="px-3 py-2">
                        <input
                          type="time"
                          value={row.start_time}
                          onChange={(e) =>
                            setCell(curDay, i, {
                              start_time: e.target.value,
                            })
                          }
                          className="w-36 rounded-lg border px-3 py-1.5 text-sm"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="time"
                          value={row.end_time}
                          onChange={(e) =>
                            setCell(curDay, i, {
                              end_time: e.target.value,
                            })
                          }
                          className="w-36 rounded-lg border px-3 py-1.5 text-sm"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={row.label}
                          onChange={(e) =>
                            setCell(curDay, i, {
                              label: e.target.value,
                            })
                          }
                          className="w-full rounded-lg border px-3 py-1.5 text-sm"
                          placeholder="1ère heure / Pause / …"
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => removeRow(curDay, i)}
                          className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-800 hover:bg-rose-100"
                        >
                          Supprimer
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex items-center justify-between">
            <button
              onClick={() => addRow(curDay)}
              className="rounded-lg border px-3 py-1.5 text-sm hover:bg-slate-50"
            >
              + Ajouter un créneau
            </button>

            <button
              onClick={savePeriods}
              disabled={savingPeriods || loadingCfg}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-emerald-700 disabled:opacity-60"
            >
              {savingPeriods
                ? "Enregistrement…"
                : "Enregistrer les créneaux"}
            </button>
          </div>

          <div className="mt-2 text-[12px] text-slate-500">
            Astuce : si vous laissez des jours vides, ils ne seront pas pris en
            compte. Le calcul de retard se base sur le créneau du jour le plus
            proche de l’heure de début de séance.
          </div>
        
          </div>
</section>

        {/* =======================
            4) Années scolaires
        ======================== */}
        <section className="rounded-2xl border border-violet-200 bg-violet-50/50 p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold uppercase tracking-wide text-slate-700">
                Années scolaires (archives & bulletins)
              </div>
              <p className="text-xs text-slate-500">
                Permet d&apos;archiver absences et notes et de filtrer les
                bulletins par année.
              </p>
            </div>
            <button
              onClick={loadAcademicYears}
              disabled={loadingAcademicYears}
              className="rounded-lg border px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-60"
            >
              {loadingAcademicYears
                ? "Chargement…"
                : "Rafraîchir"}
            </button>
          </div>

          {msgAcademicYears && (
            <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
              {msgAcademicYears}
            </div>
          )}

          

          <div className="overflow-x-auto rounded-xl border">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="w-10 px-3 py-2 text-left">#</th>
                  <th className="px-3 py-2 text-left">Code</th>
                  <th className="px-3 py-2 text-left">Libellé</th>
                  <th className="w-32 px-3 py-2 text-left">
                    Début
                  </th>
                  <th className="w-32 px-3 py-2 text-left">Fin</th>
                  <th className="w-40 px-3 py-2 text-center">
                    Année courante
                  </th>
                  <th className="w-32 px-3 py-2 text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {loadingAcademicYears ? (
                  <tr>
                    <td
                      className="px-3 py-3 text-slate-500"
                      colSpan={7}
                    >
                      Chargement des années scolaires…
                    </td>
                  </tr>
                ) : academicYears.length === 0 ? (
                  <tr>
                    <td
                      className="px-3 py-3 text-slate-500"
                      colSpan={7}
                    >
                      Aucune année scolaire définie. Ajoutez au moins une ligne
                      pour commencer.
                    </td>
                  </tr>
                ) : (
                  academicYears.map((y, index) => (
                    <tr key={y.id}>
                      <td className="px-3 py-2">{index + 1}</td>
                      <td className="px-3 py-2">
                        <input
                          value={y.code}
                          onChange={(e) =>
                            updateAcademicYear(y.id, {
                              code: e.target.value,
                            })
                          }
                          className="w-32 rounded-lg border px-2 py-1 text-sm"
                          placeholder="2024-2025"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={y.label}
                          onChange={(e) =>
                            updateAcademicYear(y.id, {
                              label: e.target.value,
                            })
                          }
                          className="w-full rounded-lg border px-2 py-1 text-sm"
                          placeholder="Année scolaire 2024-2025"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="date"
                          value={y.start_date}
                          onChange={(e) =>
                            updateAcademicYear(y.id, {
                              start_date: e.target.value,
                            })
                          }
                          className="w-32 rounded-lg border px-2 py-1 text-sm"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="date"
                          value={y.end_date}
                          onChange={(e) =>
                            updateAcademicYear(y.id, {
                              end_date: e.target.value,
                            })
                          }
                          className="w-32 rounded-lg border px-2 py-1 text-sm"
                        />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <input
                          type="radio"
                          name="current_academic_year"
                          checked={y.is_current}
                          onChange={() => {
                            setAcademicYears((prev) =>
                              prev.map((row) => ({
                                ...row,
                                is_current: row.id === y.id,
                              }))
                            );
                            setSelectedAcademicYear(
                              y.code || selectedAcademicYear
                            );
                          }}
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => removeAcademicYear(y.id)}
                          className="rounded-lg border border-rose-300 bg-rose-50 px-2 py-1 text-xs font-medium text-rose-800 hover:bg-rose-100"
                          title="Supprimer"
                        >
                          Suppr.
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={addAcademicYear}
                className="rounded-lg border px-3 py-1.5 text-sm hover:bg-slate-50"
              >
                + Ajouter une année scolaire
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={saveAcademicYears}
                disabled={savingAcademicYears}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-emerald-700 disabled:opacity-60"
              >
                {savingAcademicYears
                  ? "Enregistrement…"
                  : "Enregistrer les années scolaires"}
              </button>
            </div>
          </div>
        </section>

        {/* =======================
            5) Périodes d'évaluation (bulletins)
        ======================== */}
        <section className="rounded-2xl border border-amber-200 bg-amber-50/50 p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold uppercase tracking-wide text-slate-700">
                Périodes d&apos;évaluation (bulletins)
              </div>
              <p className="text-xs text-slate-500">
                Trimestres, semestres, compositions… Chaque période a un
                coefficient utilisé pour la moyenne annuelle.
              </p>
            </div>
            <button
              onClick={() => loadEvalPeriods()}
              disabled={loadingEvalPeriods}
              className="rounded-lg border px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-60"
            >
              {loadingEvalPeriods
                ? "Chargement…"
                : "Rafraîchir"}
            </button>
          </div>

          {msgEvalPeriods && (
            <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
              {msgEvalPeriods}
            </div>
          )}

          <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <div className="mb-1 text-xs text-slate-500">
                Année scolaire utilisée pour les périodes & bulletins
              </div>
              <select
                className="w-full rounded-lg border px-3 py-2 text-sm"
                value={selectedAcademicYear}
                onChange={async (e) => {
                  const year = e.target.value;
                  setSelectedAcademicYear(year);
                  await loadEvalPeriods(year);
                }}
              >
                <option value="">
                  — Année déduite automatiquement (serveur) —
                </option>
                {academicYears.map((y) => (
                  <option key={y.code || y.id} value={y.code}>
                    {y.code || "(sans code)"}
                    {y.is_current ? " — année courante" : ""}
                  </option>
                ))}
              </select>
              <div className="mt-1 text-[11px] text-slate-500">
                Utilisée lors de l&apos;enregistrement des périodes d&apos;évaluation.
              </div>
            </div>
          </div>
<div className="overflow-x-auto rounded-xl border">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="w-10 px-3 py-2 text-left">#</th>
                  <th className="px-3 py-2 text-left">Code</th>
                  <th className="px-3 py-2 text-left">
                    Libellé complet
                  </th>
                  <th className="px-3 py-2 text-left">
                    Libellé bulletin
                  </th>
                  <th className="w-24 px-3 py-2 text-right">
                    Coeff. période
                  </th>
                  <th className="w-32 px-3 py-2 text-left">
                    Début
                  </th>
                  <th className="w-32 px-3 py-2 text-left">
                    Fin
                  </th>
                  <th className="w-24 px-3 py-2 text-center">
                    Actif
                  </th>
                  <th className="w-32 px-3 py-2 text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {loadingEvalPeriods ? (
                  <tr>
                    <td
                      className="px-3 py-3 text-slate-500"
                      colSpan={9}
                    >
                      Chargement des périodes…
                    </td>
                  </tr>
                ) : evalPeriods.length === 0 ? (
                  <tr>
                    <td
                      className="px-3 py-3 text-slate-500"
                      colSpan={9}
                    >
                      Aucune période définie. Cliquez sur « Ajouter une période »
                      pour commencer.
                    </td>
                  </tr>
                ) : (
                  evalPeriods.map((p, index) => (
                    <tr key={p.id}>
                      <td className="px-3 py-2">{index + 1}</td>
                      <td className="px-3 py-2">
                        <input
                          value={p.code}
                          onChange={(e) =>
                            updateEvalPeriod(p.id, {
                              code: e.target.value,
                            })
                          }
                          className="w-24 rounded-lg border px-2 py-1 text-sm"
                          placeholder="T1 / S1 / JN"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={p.label}
                          onChange={(e) =>
                            updateEvalPeriod(p.id, {
                              label: e.target.value,
                            })
                          }
                          className="w-full rounded-lg border px-2 py-1 text-sm"
                          placeholder="1er trimestre 2024-2025"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={p.short_label}
                          onChange={(e) =>
                            updateEvalPeriod(p.id, {
                              short_label: e.target.value,
                            })
                          }
                          className="w-full rounded-lg border px-2 py-1 text-sm"
                          placeholder="Trim. 1 / Juin"
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          min={0}
                          step="0.5"
                          className="w-20 rounded-lg border px-2 py-1 text-right text-sm"
                          value={p.weight}
                          onChange={(e) => {
                            const raw =
                              e.target.value.replace(",", ".");
                            const num = parseFloat(raw);
                            updateEvalPeriod(p.id, {
                              weight: isNaN(num)
                                ? 1
                                : Math.max(0, num),
                            });
                          }}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="date"
                          value={p.start_date}
                          onChange={(e) =>
                            updateEvalPeriod(p.id, {
                              start_date: e.target.value,
                            })
                          }
                          className="w-32 rounded-lg border px-2 py-1 text-sm"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="date"
                          value={p.end_date}
                          onChange={(e) =>
                            updateEvalPeriod(p.id, {
                              end_date: e.target.value,
                            })
                          }
                          className="w-32 rounded-lg border px-2 py-1 text-sm"
                        />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={p.is_active}
                          onChange={(e) =>
                            updateEvalPeriod(p.id, {
                              is_active: e.target.checked,
                            })
                          }
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => moveEvalPeriod(p.id, "up")}
                            disabled={index === 0}
                            className="rounded-lg border px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-40"
                            title="Monter"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              moveEvalPeriod(p.id, "down")
                            }
                            disabled={
                              index === evalPeriods.length - 1
                            }
                            className="rounded-lg border px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-40"
                            title="Descendre"
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            onClick={() => removeEvalPeriod(p.id)}
                            className="rounded-lg border border-rose-300 bg-rose-50 px-2 py-1 text-xs font-medium text-rose-800 hover:bg-rose-100"
                            title="Supprimer"
                          >
                            Suppr.
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={addEvalPeriod}
                className="rounded-lg border px-3 py-1.5 text-sm hover:bg-slate-50"
              >
                + Ajouter une période
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={saveEvalPeriods}
                disabled={savingEvalPeriods || loadingEvalPeriods}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-emerald-700 disabled:opacity-60"
              >
                {savingEvalPeriods
                  ? "Enregistrement…"
                  : "Enregistrer les périodes"}
              </button>
            </div>
          </div>

          <div className="mt-2 text-[11px] text-slate-500">
            Exemple : trois périodes « 1er trimestre », « 2e trimestre »,
            « 3e trimestre » avec des coefficients 1, 2, 2 ; ou deux lignes
            « Semestre 1 » et « Semestre 2 ». Pour le primaire, vous pouvez
            définir « Composition de mars », « Composition de juin », etc.
          </div>
        </section>

        {/* =======================
            6) Coefficients des disciplines + sous-matières
        ======================== */}
        <section className="rounded-2xl border border-indigo-200 bg-indigo-50/50 p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold uppercase tracking-wide text-slate-700">
                Coefficients des disciplines par niveau (bulletins)
              </div>
              <p className="text-xs text-slate-500">
                Coefficient par discipline et par niveau pour la moyenne
                générale. Certaines matières peuvent être détaillées en
                sous-matières (dictée, lecture, expression écrite, TP, etc.)
                dont la somme doit respecter le coefficient de la matière.
              </p>
            </div>
            <button
              onClick={() => {
                loadSubjectCoeffs();
                loadSubjectComponents();
              }}
              disabled={loadingCoeffs || loadingComponents}
              className="rounded-lg border px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-60"
            >
              {loadingCoeffs || loadingComponents
                ? "Chargement…"
                : "Rafraîchir"}
            </button>
          </div>

          {msgCoeffs && (
            <div className="mb-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
              {msgCoeffs}
            </div>
          )}

          {msgComponents && (
            <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
              {msgComponents}
            </div>
          )}

          <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <div className="mb-1 text-xs text-slate-500">
                Niveau
              </div>
              <select
                className="w-full rounded-lg border px-3 py-2 text-sm"
                value={selectedCoeffLevel}
                onChange={(e) => setSelectedCoeffLevel(e.target.value)}
              >
                <option value="">— Choisir un niveau —</option>
                {coeffLevels.map((lvl) => (
                  <option key={lvl} value={lvl}>
                    {lvl}
                  </option>
                ))}
              </select>
              <div className="mt-1 text-[11px] text-slate-500">
                Seules les disciplines du niveau sélectionné sont affichées
                ci-dessous.
              </div>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left">Discipline</th>
                  <th className="w-32 px-3 py-2 text-right">
                    Coefficient bulletin
                  </th>
                  <th className="w-56 px-3 py-2 text-right">
                    Sous-matières (optionnel)
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {loadingCoeffs ? (
                  <tr>
                    <td
                      className="px-3 py-3 text-slate-500"
                      colSpan={3}
                    >
                      Chargement des disciplines…
                    </td>
                  </tr>
                ) : !selectedCoeffLevel ? (
                  <tr>
                    <td
                      className="px-3 py-3 text-slate-500"
                      colSpan={3}
                    >
                      Choisissez d&apos;abord un niveau pour voir et modifier
                      les coefficients.
                    </td>
                  </tr>
                ) : coeffRowsForSelectedLevel.length === 0 ? (
                  <tr>
                    <td
                      className="px-3 py-3 text-slate-500"
                      colSpan={3}
                    >
                      Aucune discipline n&apos;est encore paramétrée pour ce
                      niveau. Cliquez sur « Rafraîchir » si vous venez
                      d&apos;ajouter des matières.
                    </td>
                  </tr>
                ) : (
                  coeffRowsForSelectedLevel.map((sc) => {
                    const comps = subjectComponents.filter(
                      (c) =>
                        c.subject_id === sc.subject_id &&
                        (c.level || "") === (sc.level || "")
                    );
                    const sum = comps.reduce(
                      (s, c) => s + (Number(c.coeff) || 0),
                      0
                    );
                    const ok = Math.abs(sum - sc.coeff) < 1e-6;

                    return (
                      <tr
                        key={`${sc.level}-${sc.subject_id}`}
                      >
                        <td className="px-3 py-2 text-slate-800">
                          {sc.subject_name}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <input
                            type="number"
                            min={0}
                            step="0.5"
                            className="w-24 rounded-lg border px-2 py-1 text-right text-sm"
                            value={sc.coeff}
                            onChange={(e) => {
                              const raw =
                                e.target.value.replace(",", ".");
                              const num = parseFloat(raw);
                              setSubjectCoeffs((prev) =>
                                prev.map((row) =>
                                  row.subject_id === sc.subject_id &&
                                  row.level === sc.level
                                    ? {
                                        ...row,
                                        coeff: isNaN(num)
                                          ? 0
                                          : Math.max(0, num),
                                      }
                                    : row
                                )
                              );
                            }}
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex flex-col items-end gap-1">
                            <button
                              type="button"
                              onClick={() =>
                                openComponentsEditor(sc)
                              }
                              className="rounded-lg border px-2 py-1 text-xs hover:bg-slate-50"
                            >
                              {comps.length > 0
                                ? "Modifier les sous-matières"
                                : "Ajouter des sous-matières"}
                            </button>
                            {comps.length > 0 && (
                              <div className="text-[11px] text-slate-500">
                                {comps.length} sous-matière
                                {comps.length > 1 ? "s" : ""} — somme&nbsp;
                                <span
                                  className={
                                    "font-medium " +
                                    (ok
                                      ? "text-emerald-700"
                                      : "text-rose-700")
                                  }
                                >
                                  {sum}
                                </span>
                                {" / "}
                                <span className="font-medium">
                                  {sc.coeff}
                                </span>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="text-[11px] text-slate-500">
              Un coeff à 0 retire la matière du calcul de moyenne générale pour
              le niveau choisi. Les sous-matières (si définies) apparaissent
              dans la saisie des notes, mais le bulletin conserve le coefficient
              total de la matière mère.
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <button
                onClick={saveSubjectComponents}
                disabled={disableComponentsSaveAll}
                className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-medium text-white shadow hover:bg-sky-800 disabled:opacity-60"
              >
                {savingComponents
                  ? "Enregistrement…"
                  : "Enregistrer toutes les sous-matières"}
              </button>
              <button
                onClick={saveSubjectCoeffs}
                disabled={disableCoeffsSaveAll}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-emerald-700 disabled:opacity-60"
              >
                {savingCoeffs
                  ? "Enregistrement…"
                  : "Enregistrer les coefficients"}
              </button>
            </div>
          </div>
        </section>
      </main>

      {/* Modal mot de passe personnalisé */}
      <Modal
        open={modalOpen}
        title={`Définir un mot de passe — ${
          targetUser?.display_name ||
          targetUser?.email ||
          targetUser?.phone ||
          "Utilisateur"
        }`}
        onClose={() => setModalOpen(false)}
        actions={
          <button
            onClick={submitCustom}
            disabled={disableCustom}
            className="rounded-lg bg-sky-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-60"
          >
            {busyCustom ? "Mise à jour…" : "Valider"}
          </button>
        }
      >
        <div className="space-y-3">
          <div>
            <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
              <span>Nouveau mot de passe</span>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-[11px] text-sky-700 hover:underline"
                onClick={() => setShowCP1((v) => !v)}
              >
                {showCP1 ? (
                  <EyeOffIcon className="h-4 w-4" />
                ) : (
                  <EyeIcon className="h-4 w-4" />
                )}{" "}
                {showCP1 ? "Masquer" : "Afficher"}
              </button>
            </div>
            <input
              type={showCP1 ? "text" : "password"}
              className="w-full rounded-lg border px-3 py-2 text-sm"
              value={customPwd}
              onChange={(e) => setCustomPwd(e.target.value)}
              disabled={disableCustom}
              placeholder="••••••••"
            />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
              <span>Confirmer</span>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-[11px] text-sky-700 hover:underline"
                onClick={() => setShowCP2((v) => !v)}
              >
                {showCP2 ? (
                  <EyeOffIcon className="h-4 w-4" />
                ) : (
                  <EyeIcon className="h-4 w-4" />
                )}{" "}
                {showCP2 ? "Masquer" : "Afficher"}
              </button>
            </div>
            <input
              type={showCP2 ? "text" : "password"}
              className="w-full rounded-lg border px-3 py-2 text-sm"
              value={customPwd2}
              onChange={(e) => setCustomPwd2(e.target.value)}
              disabled={disableCustom}
              placeholder="••••••••"
            />
          </div>

          {customMsg && (
            <div className="text-sm text-slate-700">{customMsg}</div>
          )}

          <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2 text-[12px] text-yellow-800">
            Astuce : laissez ce modal et utilisez{" "}
            <b>« Réinit. temporaire »</b>{" "}
            si vous préférez générer un mot de passe provisoire côté serveur.
          </div>
        </div>
      </Modal>

      {/* Modal sous-matières / composants de discipline */}
      <Modal
        open={componentsModalOpen && !!componentsTarget}
        title={
          componentsTarget
            ? `Sous-matières — ${componentsTarget.subject_name} (${componentsTarget.level})`
            : "Sous-matières"
        }
        onClose={() => setComponentsModalOpen(false)}
        actions={
          componentsTarget && (
            <button
              type="button"
              onClick={() => saveSubjectComponents(true)}
              disabled={savingComponents}
              className="rounded-lg bg-sky-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-60"
            >
              {savingComponents
                ? "Enregistrement…"
                : "Enregistrer pour cette matière / niveau"}
            </button>
          )
        }
      >
        {!componentsTarget ? (
          <div className="text-sm text-slate-600">
            Aucune matière sélectionnée.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">
              Coefficient de la matière (
              <span className="font-semibold">
                {componentsTarget.subject_name}
              </span>
              ) au niveau{" "}
              <span className="font-semibold">
                {componentsTarget.level}
              </span>
              :{" "}
              <span className="font-semibold">
                {parentCoeffForTarget}
              </span>
              . Somme des coefficients de sous-matières :{" "}
              <span
                className={
                  "font-semibold " +
                  (coeffMatchForTarget
                    ? "text-emerald-700"
                    : "text-rose-700")
                }
              >
                {sumComponentsForTarget}
              </span>
              .
              {!coeffMatchForTarget && (
                <span className="ml-1 text-rose-700">
                  (La somme doit être égale au coefficient de la matière.)
                </span>
              )}
            </div>

            <div className="flex justify-between gap-2">
              <button
                type="button"
                onClick={addComponentForTarget}
                className="rounded-lg border px-3 py-1.5 text-xs hover:bg-slate-50"
              >
                + Ajouter une sous-matière
              </button>
            </div>

            <div className="overflow-x-auto rounded-lg border">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="w-10 px-3 py-2 text-left">#</th>
                    <th className="px-3 py-2 text-left">
                      Libellé de la sous-matière
                    </th>
                    <th className="w-24 px-3 py-2 text-right">
                      Coeff.
                    </th>
                    <th className="w-20 px-3 py-2 text-center">
                      Actif
                    </th>
                    <th className="w-24 px-3 py-2 text-right">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {componentsForTarget.length === 0 ? (
                    <tr>
                      <td
                        className="px-3 py-3 text-[12px] text-slate-500"
                        colSpan={5}
                      >
                        Aucune sous-matière définie pour cette matière et ce
                        niveau. Cliquez sur « Ajouter une sous-matière ».
                      </td>
                    </tr>
                  ) : (
                    componentsForTarget.map((c, idx) => (
                      <tr key={c.component_id}>
                        <td className="px-3 py-2">{idx + 1}</td>
                        <td className="px-3 py-2">
                          <input
                            value={c.component_name}
                            onChange={(e) =>
                              updateComponentRow(c.component_id, {
                                component_name: e.target.value,
                              })
                            }
                            className="w-full rounded-lg border px-2 py-1 text-sm"
                            placeholder="Dictée / Lecture / Expression écrite / TP…"
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <input
                            type="number"
                            min={0}
                            step="0.5"
                            className="w-20 rounded-lg border px-2 py-1 text-right text-sm"
                            value={c.coeff}
                            onChange={(e) => {
                              const raw =
                                e.target.value.replace(",", ".");
                              const num = parseFloat(raw);
                              updateComponentRow(c.component_id, {
                                coeff: isNaN(num)
                                  ? 0
                                  : Math.max(0, num),
                              });
                            }}
                          />
                        </td>
                        <td className="px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={c.is_active !== false}
                            onChange={(e) =>
                              updateComponentRow(c.component_id, {
                                is_active: e.target.checked,
                              })
                            }
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={() =>
                              removeComponentRow(c.component_id)
                            }
                            className="rounded-lg border border-rose-300 bg-rose-50 px-2 py-1 text-[11px] font-medium text-rose-800 hover:bg-rose-100"
                          >
                            Suppr.
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {!coeffMatchForTarget && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-800">
                Pour pouvoir enregistrer, la somme des coefficients de
                sous-matières doit être exactement égale au coefficient de la
                matière pour ce niveau.
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}

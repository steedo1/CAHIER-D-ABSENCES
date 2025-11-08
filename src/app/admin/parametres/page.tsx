// src/app/admin/parametres/page.tsx
"use client";

import { useEffect, useState } from "react";

/* =========================
   Types
========================= */
type Role = "super_admin" | "admin" | "educator" | "teacher" | "parent" | string;
type Profile = {
  id: string;
  display_name: string | null;
  email: string | null;
  phone: string | null;
  role: Role | null;
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
          <div className="text-lg font-semibold text-slate-800">{props.title}</div>
        </div>
        <div className="p-4">{props.children}</div>
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
    <svg viewBox="0 0 24 24" className={props.className} fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function EyeOffIcon(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={props.className} fill="none" stroke="currentColor" strokeWidth={1.8}>
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

function ToastItem({ t, onClose }: { t: Toast; onClose: (id: string) => void }) {
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
    <div className={`pointer-events-auto flex items-start gap-2 rounded-xl border px-3 py-2 shadow ${styles}`}>
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

function ToastHost({ toasts, onClose }: { toasts: Toast[]; onClose: (id: string) => void }) {
  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[60] flex w-[min(92vw,360px)] flex-col gap-2">
      {toasts.map((t) => (
        <ToastItem key={t.id} t={t} onClose={onClose} />
      ))}
    </div>
  );
}

/* =========================
   Page
========================= */
export default function AdminSettingsPage() {
  /* ---------- Toast manager ---------- */
  const [toasts, setToasts] = useState<Toast[]>([]);
  const pushToast = (kind: ToastKind, text: string) =>
    setToasts((l) => [...l, { id: rid(), kind, text }]);
  const closeToast = (id: string) => setToasts((l) => l.filter((t) => t.id !== id));

  /* ----- Mon mot de passe ----- */
  const [pwd1, setPwd1] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [show1, setShow1] = useState(false);
  const [show2, setShow2] = useState(false);
  const [busyMine, setBusyMine] = useState(false);
  const [msgMine, setMsgMine] = useState<string | null>(null);

  /* ----- Réinitialiser mot de passe d’un user ----- */
  const [q, setQ] = useState("");
  const [users, setUsers] = useState<Profile[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [errUsers, setErrUsers] = useState<string | null>(null);

  // Modal pour définir un mot de passe personnalisé
  const [modalOpen, setModalOpen] = useState(false);
  const [targetUser, setTargetUser] = useState<Profile | null>(null);
  const [customPwd, setCustomPwd] = useState("");
  const [customPwd2, setCustomPwd2] = useState("");
  const [busyCustom, setBusyCustom] = useState(false);
  const [customMsg, setCustomMsg] = useState<string | null>(null);
  const [showCP1, setShowCP1] = useState(false);
  const [showCP2, setShowCP2] = useState(false);

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

  /* ====== Chargement des utilisateurs ====== */
  async function loadUsers() {
    setErrUsers(null);
    setLoadingUsers(true);
    try {
      const r = await fetch(`/api/admin/users?q=${encodeURIComponent(q)}`, { cache: "no-store" });
      const j = await r.json();
      setUsers(Array.isArray(j.items) ? j.items : []);
      pushToast("info", `Utilisateurs chargés (${Array.isArray(j.items) ? j.items.length : 0})`);
    } catch (e: any) {
      const m = e?.message || "Impossible de charger les utilisateurs.";
      setErrUsers(m);
      pushToast("error", m);
    } finally {
      setLoadingUsers(false);
    }
  }
  useEffect(() => {
    // chargement initial
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ====== Réinit temporaire ====== */
  async function resetTemp(user: Profile) {
    if (!user?.id) return;
    if (!confirm(`Réinitialiser le mot de passe de ${user.display_name || user.email || user.phone} ?`)) return;
    try {
      const r = await fetch("/api/admin/users/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: user.id }), // mot de passe temporaire côté serveur
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || "Échec de réinitialisation");
      alert("Mot de passe réinitialisé (temporaire). Communiquez-le à l'utilisateur.");
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
        body: JSON.stringify({ user_id: targetUser.id, new_password: customPwd }),
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

  const roleColor = (r?: Role | null): "violet" | "sky" | "rose" | "slate" =>
    r === "super_admin" ? "violet" : r === "admin" ? "sky" : r === "teacher" ? "rose" : "slate";

  const disableMine = busyMine;
  const disableCustom = busyCustom;

  /* =======================
     3) Horaires & séances
  ======================== */
  const [cfg, setCfg] = useState({
    tz: "Africa/Abidjan",
    auto_lateness: true,
    default_session_minutes: 60,
  });
  const [savingCfg, setSavingCfg] = useState(false);

  type Period = { weekday: number; label: string; start_time: string; end_time: string };
  const [curDay, setCurDay] = useState<number>(1); // 1=Lundi … 6=Samedi
  const [byDay, setByDay] = useState<Record<number, Period[]>>({});
  const [loadingCfg, setLoadingCfg] = useState(false);
  const [savingPeriods, setSavingPeriods] = useState(false);
  const [msgSched, setMsgSched] = useState<string | null>(null);

  async function loadInstitutionConfig() {
    setLoadingCfg(true);
    setMsgSched(null);
    try {
      const [c, p] = await Promise.all([
        fetch("/api/admin/institution/settings", { cache: "no-store" }).then(r => r.json()),
        fetch("/api/admin/institution/periods", { cache: "no-store" }).then(r => r.json()),
      ]);
      setCfg({
        tz: c?.tz || "Africa/Abidjan",
        auto_lateness: !!c?.auto_lateness,
        default_session_minutes: Number(c?.default_session_minutes || 60),
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
      pushToast("error", e?.message || "Chargement des paramètres impossible.");
    } finally {
      setLoadingCfg(false);
    }
  }
  useEffect(() => {
    loadInstitutionConfig();
  }, []);

  function addRow(day: number) {
    setByDay(m => {
      const list = (m[day] || []).slice();
      list.push({ weekday: day, label: "Séance", start_time: "08:00", end_time: "08:55" });
      return { ...m, [day]: list };
    });
    pushToast("info", "Créneau ajouté (non enregistré).");
  }
  function removeRow(day: number, idx: number) {
    setByDay(m => {
      const list = (m[day] || []).slice();
      list.splice(idx, 1);
      return { ...m, [day]: list };
    });
    pushToast("info", "Créneau supprimé (non enregistré).");
  }
  function setCell(day: number, idx: number, patch: Partial<Period>) {
    setByDay(m => {
      const list = (m[day] || []).slice();
      const cur = list[idx] || { weekday: day, label: "Séance", start_time: "08:00", end_time: "08:55" };
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
      Object.keys(byDay).forEach(k => {
        const d = Number(k);
        (byDay[d] || []).forEach(p => {
          if (p.start_time && p.end_time) all.push({ ...p, weekday: d });
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

  return (
    <>
      <ToastHost toasts={toasts} onClose={closeToast} />

      <main className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
        <header className="mb-2">
          <h1 className="text-2xl font-semibold text-slate-900">Paramètres</h1>
          <p className="text-sm text-slate-600">Gérez votre mot de passe, vos utilisateurs, et les horaires de l’établissement.</p>
        </header>

        {/* =======================
            1) Mon mot de passe
        ======================== */}
        <section className="rounded-2xl border bg-white p-5">
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
                  onClick={() => setShow1(v => !v)}
                >
                  {show1 ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />} {show1 ? "Masquer" : "Afficher"}
                </button>
              </div>
              <input
                type={show1 ? "text" : "password"}
                className="w-full rounded-lg border px-3 py-2 text-sm"
                value={pwd1}
                onChange={e => setPwd1(e.target.value)}
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
                  onClick={() => setShow2(v => !v)}
                >
                  {show2 ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />} {show2 ? "Masquer" : "Afficher"}
                </button>
              </div>
              <input
                type={show2 ? "text" : "password"}
                className="w-full rounded-lg border px-3 py-2 text-sm"
                value={pwd2}
                onChange={e => setPwd2(e.target.value)}
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

          {msgMine && <div className="mt-2 text-sm text-slate-700">{msgMine}</div>}
        </section>

        {/* ==========================================
            2) Réinitialiser le mot de passe d'un user
        =========================================== */}
        <section className="rounded-2xl border bg-white p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold uppercase tracking-wide text-slate-700">
              Réinitialiser le mot de passe d’un utilisateur
            </div>
            <div className="flex items-center gap-2">
              <input
                placeholder="Recherche : nom, email, téléphone…"
                className="w-64 rounded-lg border px-3 py-1.5 text-sm"
                value={q}
                onChange={e => setQ(e.target.value)}
                onKeyDown={e => e.key === "Enter" && loadUsers()}
              />
              <button
                onClick={loadUsers}
                className="rounded-lg border px-3 py-1.5 text-sm hover:bg-slate-50"
                disabled={loadingUsers}
                title="Rechercher"
              >
                {loadingUsers ? "Recherche…" : "Rechercher"}
              </button>
            </div>
          </div>

          {errUsers && (
            <div className="mb-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {errUsers}
            </div>
          )}

          {loadingUsers ? (
            <div className="text-sm text-slate-500">Chargement des utilisateurs…</div>
          ) : users.length === 0 ? (
            <div className="text-sm text-slate-500">Aucun utilisateur trouvé.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b bg-slate-50 text-slate-600">
                    <th className="px-3 py-2 text-left">Utilisateur</th>
                    <th className="px-3 py-2 text-left">Contact</th>
                    <th className="px-3 py-2 text-left">Rôle</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id} className="border-b">
                      <td className="px-3 py-2">
                        <div className="font-medium text-slate-800">{u.display_name || "—"}</div>
                        <div className="text-[11px] text-slate-500">{u.id}</div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="text-slate-700">{u.email || "—"}</div>
                        <div className="text-[12px] text-slate-500">{u.phone || ""}</div>
                      </td>
                      <td className="px-3 py-2">
                        <Badge color={roleColor(u.role || undefined)}>{u.role || "—"}</Badge>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => resetTemp(u)}
                            className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100"
                            title="Réinitialiser avec mot de passe temporaire"
                          >
                            Réinit. temporaire
                          </button>
                          <button
                            onClick={() => openCustom(u)}
                            className="rounded-lg border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-800 hover:bg-sky-100"
                            title="Définir un mot de passe"
                          >
                            Définir…
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* =======================
            3) Horaires & séances
        ======================== */}
        <section className="rounded-2xl border bg-white p-5">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold uppercase tracking-wide text-slate-700">
                Horaires & séances de l’établissement
              </div>
              <p className="text-xs text-slate-500">
                Définissez le fuseau horaire, la durée par séance et les créneaux journaliers. Ces paramètres pilotent le calcul automatique des retards.
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

          {/* Paramètres d’établissement */}
          <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <div className="mb-1 text-xs text-slate-500">Fuseau horaire</div>
              <select
                className="w-full rounded-lg border px-3 py-2 text-sm"
                value={cfg.tz}
                onChange={e => setCfg(s => ({ ...s, tz: e.target.value }))}
                disabled={loadingCfg || savingCfg}
              >
                <option value="Africa/Abidjan">Africa/Abidjan (UTC+0)</option>
                <option value="Africa/Lagos">Africa/Lagos (UTC+1)</option>
                <option value="Africa/Dakar">Africa/Dakar (UTC+0)</option>
                <option value="UTC">UTC</option>
              </select>
            </div>
            <div>
              <div className="mb-1 text-xs text-slate-500">Durée par séance (minutes)</div>
              <input
                type="number"
                min={1}
                className="w-full rounded-lg border px-3 py-2 text-sm"
                value={cfg.default_session_minutes}
                onChange={e =>
                  setCfg(s => ({
                    ...s,
                    default_session_minutes: Math.max(1, parseInt(e.target.value || "60", 10)),
                  }))
                }
                disabled={loadingCfg || savingCfg}
              />
              <div className="mt-1 text-[11px] text-slate-500">
                Utilisée comme valeur par défaut lors de l’ouverture de séance (UI), sans forcer vos créneaux ci-dessous.
              </div>
            </div>
            <div className="flex items-end">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!cfg.auto_lateness}
                  onChange={e => setCfg(s => ({ ...s, auto_lateness: e.target.checked }))}
                  disabled={loadingCfg || savingCfg}
                />
                <span className="text-sm text-slate-700">Calcul automatique des retards (par créneau)</span>
              </label>
            </div>
          </div>

          <div className="mb-3 flex items-center gap-2">
            <button
              onClick={saveConfig}
              disabled={savingCfg || loadingCfg}
              className="rounded-lg bg-sky-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-60"
            >
              {savingCfg ? "Enregistrement…" : "Enregistrer les paramètres"}
            </button>
            {msgSched && <span className="text-sm text-slate-700">{msgSched}</span>}
          </div>

          {/* Onglets jours */}
          <div className="mb-2 flex flex-wrap gap-2">
            {[
              { d: 1, n: "Lun" },
              { d: 2, n: "Mar" },
              { d: 3, n: "Mer" },
              { d: 4, n: "Jeu" },
              { d: 5, n: "Ven" },
              { d: 6, n: "Sam" },
            ].map(w => (
              <button
                key={w.d}
                onClick={() => setCurDay(w.d)}
                className={`rounded-lg border px-3 py-1.5 text-sm ${
                  curDay === w.d ? "bg-slate-900 text-white" : "hover:bg-slate-50"
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
                  <th className="px-3 py-2 w-12">#</th>
                  <th className="px-3 py-2 w-36">Début</th>
                  <th className="px-3 py-2 w-36">Fin</th>
                  <th className="px-3 py-2">Libellé</th>
                  <th className="px-3 py-2 w-24 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {loadingCfg ? (
                  <tr>
                    <td className="px-3 py-3 text-slate-500" colSpan={5}>
                      Chargement…
                    </td>
                  </tr>
                ) : (byDay[curDay] || []).length === 0 ? (
                  <tr>
                    <td className="px-3 py-3 text-slate-500" colSpan={5}>
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
                          onChange={e => setCell(curDay, i, { start_time: e.target.value })}
                          className="w-36 rounded-lg border px-3 py-1.5 text-sm"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="time"
                          value={row.end_time}
                          onChange={e => setCell(curDay, i, { end_time: e.target.value })}
                          className="w-36 rounded-lg border px-3 py-1.5 text-sm"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={row.label}
                          onChange={e => setCell(curDay, i, { label: e.target.value })}
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
              {savingPeriods ? "Enregistrement…" : "Enregistrer les créneaux"}
            </button>
          </div>

          <div className="mt-2 text-[12px] text-slate-500">
            Astuce : si vous laissez des jours vides, ils ne seront pas pris en compte. Le calcul de retard se base sur le créneau du jour le plus proche de l’heure de début de séance.
          </div>
        </section>

        {/* Modal mot de passe personnalisé */}
        <Modal
          open={modalOpen}
          title={`Définir un mot de passe — ${targetUser?.display_name || targetUser?.email || targetUser?.phone || "Utilisateur"}`}
          onClose={() => setModalOpen(false)}
          actions={
            <>
              <button
                onClick={submitCustom}
                disabled={disableCustom}
                className="rounded-lg bg-sky-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-60"
              >
                {busyCustom ? "Mise à jour…" : "Valider"}
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <div>
              <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
                <span>Nouveau mot de passe</span>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-[11px] text-sky-700 hover:underline"
                  onClick={() => setShowCP1(v => !v)}
                >
                  {showCP1 ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />} {showCP1 ? "Masquer" : "Afficher"}
                </button>
              </div>
              <input
                type={showCP1 ? "text" : "password"}
                className="w-full rounded-lg border px-3 py-2 text-sm"
                value={customPwd}
                onChange={e => setCustomPwd(e.target.value)}
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
                  onClick={() => setShowCP2(v => !v)}
                >
                  {showCP2 ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />} {showCP2 ? "Masquer" : "Afficher"}
                </button>
              </div>
              <input
                type={showCP2 ? "text" : "password"}
                className="w-full rounded-lg border px-3 py-2 text-sm"
                value={customPwd2}
                onChange={e => setCustomPwd2(e.target.value)}
                disabled={disableCustom}
                placeholder="••••••••"
              />
            </div>

            {customMsg && <div className="text-sm text-slate-700">{customMsg}</div>}

            <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2 text-[12px] text-yellow-800">
              Astuce : laissez ce modal et utilisez <b>“Réinit. temporaire”</b> si vous préférez
              générer un mot de passe provisoire (par défaut côté serveur).
            </div>
          </div>
        </Modal>
      </main>
    </>
  );
}

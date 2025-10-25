// src/app/admin/parametres/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

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
function Badge({ children, color = "sky" }: { children: React.ReactNode; color?: "sky" | "violet" | "rose" | "slate" }) {
  const map: Record<string, string> = {
    sky: "bg-sky-50 text-sky-700 border-sky-200",
    violet: "bg-violet-50 text-violet-700 border-violet-200",
    rose: "bg-rose-50 text-rose-700 border-rose-200",
    slate: "bg-slate-50 text-slate-700 border-slate-200",
  };
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${map[color]}`}>{children}</span>;
}

function Modal(props: { open: boolean; title: string; onClose: () => void; children: React.ReactNode; actions?: React.ReactNode }) {
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
          <button onClick={props.onClose} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-slate-50">
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
   Page
========================= */
export default function AdminSettingsPage() {
  /* ----- Mon mot de passe ----- */
  const [pwd1, setPwd1] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [show1, setShow1] = useState(false);
  const [show2, setShow2] = useState(false);
  const [busyMine, setBusyMine] = useState(false);
  const [msgMine, setMsgMine] = useState<string | null>(null);

  /* ----- RÃ©initialiser mot de passe dâ€™un user ----- */
  const [q, setQ] = useState("");
  const [users, setUsers] = useState<Profile[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [errUsers, setErrUsers] = useState<string | null>(null);

  // Modal pour dÃ©finir un mot de passe personnalisÃ©
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
    if (!pwd1 || pwd1.length < 6) return setMsgMine("Mot de passe trop court (6 caractÃ¨res minimum).");
    if (pwd1 !== pwd2) return setMsgMine("La confirmation ne correspond pas.");
    setBusyMine(true);
    try {
      const r = await fetch("/api/admin/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ new_password: pwd1 }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || "Ã‰chec de mise Ã  jour");
      setMsgMine("Mot de passe mis Ã  jour âœ…");
      setPwd1("");
      setPwd2("");
    } catch (e: any) {
      setMsgMine(e?.message || "Erreur");
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
    } catch (e: any) {
      setErrUsers(e?.message || "Impossible de charger les utilisateurs.");
    } finally {
      setLoadingUsers(false);
    }
  }
  useEffect(() => {
    // chargement initial
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ====== RÃ©init temporaire ====== */
  async function resetTemp(user: Profile) {
    if (!user?.id) return;
    if (!confirm(`RÃ©initialiser le mot de passe de ${user.display_name || user.email || user.phone} ?`)) return;
    try {
      const r = await fetch("/api/admin/users/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: user.id }), // mot de passe temporaire cÃ´tÃ© serveur
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || "Ã‰chec de rÃ©initialisation");
      alert("Mot de passe rÃ©initialisÃ© (temporaire). Communiquez-le Ã  l'utilisateur.");
    } catch (e: any) {
      alert(e?.message || "Erreur");
    }
  }

  /* ====== RÃ©init personnalisÃ© (modal) ====== */
  function openCustom(user: Profile) {
    setTargetUser(user);
    setCustomPwd("");
    setCustomPwd2("");
    setCustomMsg(null);
    setModalOpen(true);
  }
  async function submitCustom() {
    setCustomMsg(null);
    if (!targetUser?.id) return setCustomMsg("Utilisateur invalide.");
    if (!customPwd || customPwd.length < 6) return setCustomMsg("Mot de passe trop court (6+).");
    if (customPwd !== customPwd2) return setCustomMsg("La confirmation ne correspond pas.");
    setBusyCustom(true);
    try {
      const r = await fetch("/api/admin/users/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: targetUser.id, new_password: customPwd }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || "Ã‰chec de rÃ©initialisation");
      setCustomMsg("Mot de passe mis Ã  jour âœ…");
      setTimeout(() => setModalOpen(false), 600);
    } catch (e: any) {
      setCustomMsg(e?.message || "Erreur");
    } finally {
      setBusyCustom(false);
    }
  }

  const roleColor = (r?: Role | null) =>
    r === "super_admin" ? "violet" : r === "admin" ? "sky" : r === "teacher" ? "rose" : "slate";

  const disableMine = busyMine;
  const disableCustom = busyCustom;

  return (
    <main className="mx-auto max-w-6xl p-4 md:p-6 space-y-6">
      <header className="mb-2">
        <h1 className="text-2xl font-semibold text-slate-900">ParamÃ¨tres</h1>
        <p className="text-sm text-slate-600">GÃ©rez votre mot de passe et ceux de vos utilisateurs.</p>
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
                onClick={() => setShow1((v) => !v)}
              >
                {show1 ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />} {show1 ? "Masquer" : "Afficher"}
              </button>
            </div>
            <input
              type={show1 ? "text" : "password"}
              className="w-full rounded-lg border px-3 py-2 text-sm"
              value={pwd1}
              onChange={(e) => setPwd1(e.target.value)}
              disabled={disableMine}
              placeholder="â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢"
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
                {show2 ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />} {show2 ? "Masquer" : "Afficher"}
              </button>
            </div>
            <input
              type={show2 ? "text" : "password"}
              className="w-full rounded-lg border px-3 py-2 text-sm"
              value={pwd2}
              onChange={(e) => setPwd2(e.target.value)}
              disabled={disableMine}
              placeholder="â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢"
            />
          </div>

          <div className="flex items-end">
            <button
              onClick={changeMyPassword}
              disabled={disableMine}
              className="rounded-xl bg-sky-700 text-white px-4 py-2 text-sm font-medium shadow disabled:opacity-60 hover:bg-sky-800"
            >
              {busyMine ? "Mise Ã  jourâ€¦" : "Changer mon mot de passe"}
            </button>
          </div>
        </div>

        {msgMine && <div className="mt-2 text-sm text-slate-700">{msgMine}</div>}
      </section>

      {/* ==========================================
          2) RÃ©initialiser le mot de passe d'un user
      =========================================== */}
      <section className="rounded-2xl border bg-white p-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            RÃ©initialiser le mot de passe dâ€™un utilisateur
          </div>
          <div className="flex items-center gap-2">
            <input
              placeholder="Recherche : nom, email, tÃ©lÃ©phoneâ€¦"
              className="w-64 rounded-lg border px-3 py-1.5 text-sm"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && loadUsers()}
            />
            <button
              onClick={loadUsers}
              className="rounded-lg border px-3 py-1.5 text-sm hover:bg-slate-50"
              disabled={loadingUsers}
              title="Rechercher"
            >
              {loadingUsers ? "Rechercheâ€¦" : "Rechercher"}
            </button>
          </div>
        </div>

        {errUsers && <div className="mb-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{errUsers}</div>}

        {loadingUsers ? (
          <div className="text-sm text-slate-500">Chargement des utilisateursâ€¦</div>
        ) : users.length === 0 ? (
          <div className="text-sm text-slate-500">Aucun utilisateur trouvÃ©.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b bg-slate-50 text-slate-600">
                  <th className="px-3 py-2 text-left">Utilisateur</th>
                  <th className="px-3 py-2 text-left">Contact</th>
                  <th className="px-3 py-2 text-left">RÃ´le</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b">
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-800">{u.display_name || "â€”"}</div>
                      <div className="text-[11px] text-slate-500">{u.id}</div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-slate-700">{u.email || "â€”"}</div>
                      <div className="text-[12px] text-slate-500">{u.phone || ""}</div>
                    </td>
                    <td className="px-3 py-2">
                      <Badge color={roleColor(u.role || undefined)}>{u.role || "â€”"}</Badge>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => resetTemp(u)}
                          className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100"
                          title="RÃ©initialiser avec mot de passe temporaire"
                        >
                          RÃ©init. temporaire
                        </button>
                        <button
                          onClick={() => openCustom(u)}
                          className="rounded-lg border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-800 hover:bg-sky-100"
                          title="DÃ©finir un mot de passe"
                        >
                          DÃ©finirâ€¦
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

      {/* Modal mot de passe personnalisÃ© */}
      <Modal
        open={modalOpen}
        title={`DÃ©finir un mot de passe â€” ${(targetUser?.display_name || targetUser?.email || targetUser?.phone || "Utilisateur")}`}
        onClose={() => setModalOpen(false)}
        actions={
          <>
            <button
              onClick={submitCustom}
              disabled={disableCustom}
              className="rounded-lg bg-sky-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-60"
            >
              {busyCustom ? "Mise Ã  jourâ€¦" : "Valider"}
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
                onClick={() => setShowCP1((v) => !v)}
              >
                {showCP1 ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />} {showCP1 ? "Masquer" : "Afficher"}
              </button>
            </div>
            <input
              type={showCP1 ? "text" : "password"}
              className="w-full rounded-lg border px-3 py-2 text-sm"
              value={customPwd}
              onChange={(e) => setCustomPwd(e.target.value)}
              disabled={disableCustom}
              placeholder="â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢"
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
                {showCP2 ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />} {showCP2 ? "Masquer" : "Afficher"}
              </button>
            </div>
            <input
              type={showCP2 ? "text" : "password"}
              className="w-full rounded-lg border px-3 py-2 text-sm"
              value={customPwd2}
              onChange={(e) => setCustomPwd2(e.target.value)}
              disabled={disableCustom}
              placeholder="â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢"
            />
          </div>

          {customMsg && <div className="text-sm text-slate-700">{customMsg}</div>}

          <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2 text-[12px] text-yellow-800">
            Astuce : laissez ce modal et utilisez <b>â€œRÃ©init. temporaireâ€</b> si vous prÃ©fÃ©rez
            gÃ©nÃ©rer un mot de passe provisoire : Pass2025.
          </div>
        </div>
      </Modal>
    </main>
  );
}



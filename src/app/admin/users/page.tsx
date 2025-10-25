// src/app/admin/users/page.tsx
"use client";

import { useEffect, useState } from "react";

function Input(p: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...p}
      className={
        "w-full rounded-lg border px-3 py-2 text-sm " + (p.className ?? "")
      }
    />
  );
}
function Button(p: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...p}
      className={
        "rounded-xl bg-emerald-600 text-white px-4 py-2 text-sm font-medium shadow " +
        (p.disabled ? "opacity-60" : "hover:bg-emerald-700 transition")
      }
    />
  );
}
function Help({ children }: { children: any }) {
  return (
    <div className="mb-3 rounded border border-amber-200 bg-amber-50 p-2 text-[12px] text-amber-800">
      {children}
    </div>
  );
}

type SubjectItem = { id: string; name: string };

// Réponse /api/admin/users (recherche)
type AdminUserItem = {
  id: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
};

export default function UsersPage() {
  // État auth (session expirée)
  const [authErr, setAuthErr] = useState(false);

  // ENSEIGNANT (création)
  const [tEmail, setTEmail] = useState("");
  const [tPhone, setTPhone] = useState("");
  const [tName, setTName] = useState("");
  const [tSubject, setTSubject] = useState(""); // discipline (optionnelle)

  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Suggestions de disciplines
  const [subjects, setSubjects] = useState<SubjectItem[]>([]);
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/admin/subjects", { cache: "no-store" });
        if (r.status === 401) {
          setAuthErr(true);
          return;
        }
        const j = await r.json().catch(() => ({}));
        setSubjects(j.items || []);
      } catch {
        setMsg("Impossible de charger les disciplines.");
      }
    })();
  }, []);

  async function createTeacher() {
    setSubmitting(true);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/users/create", {
        method: "POST",
        headers: new Headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          role: "teacher",
          email: tEmail.trim() || null, // email optionnel
          phone: tPhone.trim(), // téléphone obligatoire
          display_name: tName.trim() || null,
          subject: tSubject.trim() || null, // discipline optionnelle
        }),
      });
      const j = await r.json().catch(() => ({}));
      setSubmitting(false);
      if (r.status === 401) {
        setAuthErr(true);
        return;
      }
      if (!r.ok) {
        setMsg(j?.error || "Échec");
        return;
      }
      setMsg("Enseignant créé.");
      setTEmail("");
      setTPhone("");
      setTName("");
      setTSubject("");
    } catch {
      setSubmitting(false);
      setMsg("Erreur réseau.");
    }
  }

  // ───────────────── Retirer un enseignant ─────────────────
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<AdminUserItem[]>([]);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [rmMsg, setRmMsg] = useState<string | null>(null);

  async function searchUsers() {
    if (!q.trim()) return;
    setSearching(true);
    setRmMsg(null);
    try {
      const url = `/api/admin/users?q=${encodeURIComponent(q.trim())}`;
      const r = await fetch(url, { cache: "no-store" });
      if (r.status === 401) {
        setAuthErr(true);
        setResults([]);
        setSearching(false);
        return;
      }
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setRmMsg(j?.error || "Recherche impossible.");
        setResults([]);
      } else {
        setResults((j.items || []) as AdminUserItem[]);
      }
    } catch (e: any) {
      setRmMsg(e?.message || "Erreur de recherche.");
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  async function removeTeacher(profile_id: string) {
    setRemovingId(profile_id);
    setRmMsg(null);
    try {
      const r = await fetch("/api/admin/teachers/remove", {
        method: "POST",
        headers: new Headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          profile_id,
          end_open_sessions: true,
          unset_profile_institution: true, // nettoie institution active si c'était celle-ci
        }),
      });
      if (r.status === 401) {
        setAuthErr(true);
        setRemovingId(null);
        return;
      }
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setRmMsg(j?.error || "Échec de la suppression.");
        return;
      }
      const ended = j?.ended_sessions ? ` — ${j.ended_sessions} séance(s) clôturée(s)` : "";
      const cleared = j?.cleared_institution ? " — institution active nettoyée" : "";
      setRmMsg(`Enseignant retiré de l’établissement${ended}${cleared}.`);
      setResults((prev) => prev.filter((u) => u.id !== profile_id));
    } catch (e: any) {
      setRmMsg(e?.message || "Erreur réseau.");
    } finally {
      setRemovingId(null);
    }
  }

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
        <h1 className="text-2xl font-semibold">Enseignants</h1>
        <p className="text-slate-600">
          Créer des comptes enseignants (mot de passe temporaire) et donner une
          discipline principale (optionnelle).
        </p>
      </div>

      {/* Carte 1 : Création enseignant */}
      <div className="rounded-2xl border bg-white p-5">
        <div className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-700">
          Créer un enseignant
        </div>
        <Help>
          Téléphone <b>obligatoire</b> (pour la connexion). Email <b>facultatif</b>.
          La discipline est <b>optionnelle</b> (utile surtout au secondaire).
        </Help>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <div className="mb-1 text-xs text-slate-500">Nom affiché</div>
            <Input
              value={tName}
              onChange={(e) => setTName(e.target.value)}
              placeholder="Mme/M. NOM"
              autoComplete="name"
            />
          </div>
          <div>
            <div className="mb-1 text-xs text-slate-500">Email (optionnel)</div>
            <Input
              type="email"
              value={tEmail}
              onChange={(e) => setTEmail(e.target.value)}
              placeholder="enseignant@exemple.com"
              autoComplete="email"
            />
          </div>
          <div>
            <div className="mb-1 text-xs text-slate-500">Téléphone</div>
            <Input
              type="tel"
              value={tPhone}
              onChange={(e) => setTPhone(e.target.value)}
              placeholder="+225..."
              autoComplete="tel"
            />
          </div>
          <div>
            <div className="mb-1 text-xs text-slate-500">Discipline (optionnel)</div>
            <Input
              list="subjects-list"
              value={tSubject}
              onChange={(e) => setTSubject(e.target.value)}
              placeholder="Mathématiques, Français…"
            />
            <datalist id="subjects-list">
              {subjects.map((s) => (
                <option key={s.id} value={s.name} />
              ))}
            </datalist>
            <div className="mt-1 text-[11px] text-slate-500">
              Tu peux saisir une nouvelle discipline ou choisir une existante.
            </div>
          </div>
        </div>

        <div className="mt-4">
          <Button onClick={createTeacher} disabled={submitting || !tPhone.trim()}>
            {submitting ? "Création…" : "Créer l’enseignant"}
          </Button>
        </div>
        {msg && (
          <div className="mt-2 text-sm text-slate-600" aria-live="polite">
            {msg}
          </div>
        )}
      </div>

      {/* Carte 2 : Retirer un enseignant */}
      <div className="rounded-2xl border bg-white p-5">
        <div className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-700">
          Retirer un enseignant de l’établissement
        </div>
        <Help>
          Recherchez l’utilisateur par <b>nom</b>, <b>email</b> ou <b>téléphone</b>,
          puis cliquez sur <b>Retirer</b>. L’action enlève le rôle <code>teacher</code> pour
          votre établissement, clôture les séances ouvertes et, si besoin, met{" "}
          <code>profiles.institution_id</code> à <code>NULL</code> lorsqu’il pointait
          encore sur votre établissement (ainsi, il ne voit plus vos classes).
        </Help>

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <div className="mb-1 text-xs text-slate-500">Recherche</div>
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Nom, email ou téléphone"
              onKeyDown={(e) => {
                if (e.key === "Enter") searchUsers();
              }}
            />
          </div>
          <Button onClick={searchUsers} disabled={searching || !q.trim()}>
            {searching ? "Recherche…" : "Rechercher"}
          </Button>
        </div>

        {/* Résultats */}
        <div className="mt-4 space-y-2">
          {results.length === 0 ? (
            <div className="text-sm text-slate-500">Aucun résultat pour l’instant.</div>
          ) : (
            results.map((u) => (
              <div key={u.id} className="flex items-center justify-between rounded-xl border p-3">
                <div className="min-w-0">
                  <div className="truncate font-medium">{u.display_name || "(Sans nom)"}</div>
                  <div className="truncate text-xs text-slate-500">
                    {u.email || "—"} {u.phone ? `• ${u.phone}` : ""} {u.role ? `• rôle: ${u.role}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => removeTeacher(u.id)}
                    disabled={removingId === u.id}
                    className="rounded-xl bg-red-600 text-white px-3 py-1.5 text-sm font-medium shadow hover:bg-red-700 disabled:opacity-60"
                    title="Retirer le rôle teacher pour cet établissement"
                  >
                    {removingId === u.id ? "Retrait…" : "Retirer"}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {rmMsg && (
          <div className="mt-3 text-sm text-slate-600" aria-live="polite">
            {rmMsg}
          </div>
        )}
      </div>
    </div>
  );
}

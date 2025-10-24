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

// Pour la recherche dâ€™utilisateurs (rÃ©ponse /api/admin/users)
type AdminUserItem = {
  id: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  role: string | null; // rÃ´le â€œprincipalâ€ (peut Ãªtre admin/teacher/â€¦)
};

export default function UsersPage() {
  // ENSEIGNANT (crÃ©ation)
  const [tEmail, setTEmail] = useState("");
  const [tPhone, setTPhone] = useState("");
  const [tName, setTName] = useState("");
  const [tSubject, setTSubject] = useState(""); // discipline (optionnelle)

  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // suggestions de disciplines de l'Ã©tablissement
  const [subjects, setSubjects] = useState<SubjectItem[]>([]);
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/admin/subjects", {
          cache: "no-store",
          credentials: "include", // â† important pour Ã©viter 401
        });
        if (r.status === 401) {
          setMsg("Votre session a expirÃ©. Veuillez vous reconnecter.");
          return;
        }
        const j = await r.json().catch(() => ({}));
        setSubjects(j.items || []);
      } catch (e) {
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
        credentials: "include", // â† important pour Ã©viter 401
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: "teacher",
          email: tEmail.trim() || null, // email optionnel
          phone: tPhone,
          display_name: tName || null,
          subject: tSubject.trim() || null, // discipline optionnelle
        }),
      });
      const j = await r.json().catch(() => ({}));
      setSubmitting(false);
      if (r.status === 401) {
        setMsg("Votre session a expirÃ©. Veuillez vous reconnecter.");
        return;
      }
      if (!r.ok) {
        setMsg(j?.error || "Ã‰chec");
        return;
      }
      setMsg("Enseignant crÃ©Ã©.");
      setTEmail("");
      setTPhone("");
      setTName("");
      setTSubject("");
    } catch (e: any) {
      setSubmitting(false);
      setMsg("Erreur rÃ©seau.");
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // RETIRER UN ENSEIGNANT (UI + actions)
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<AdminUserItem[]>([]);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [rmMsg, setRmMsg] = useState<string | null>(null);

  async function searchUsers() {
    setSearching(true);
    setRmMsg(null);
    try {
      const url = `/api/admin/users?q=${encodeURIComponent(q)}`;
      const r = await fetch(url, { cache: "no-store", credentials: "include" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setRmMsg(j?.error || "Recherche impossible.");
        setResults([]);
      } else {
        // On garde les 50 premiers cÃ´tÃ© serveur ; cÃ´tÃ© client on peut trier/filtrer
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
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile_id,
          end_open_sessions: true,
          unset_profile_institution: true, // â† nettoie lâ€™institution active si câ€™Ã©tait celle-ci
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setRmMsg(j?.error || "Ã‰chec de la suppression.");
        return;
      }
      // Feedback lisible
      const ended = j?.ended_sessions ? ` â€” ${j.ended_sessions} sÃ©ance(s) clÃ´turÃ©e(s)` : "";
      const cleared = j?.cleared_institution ? " â€” institution active nettoyÃ©e" : "";
      setRmMsg(`Enseignant retirÃ© de lâ€™Ã©tablissement${ended}${cleared}.`);

      // Retire de la liste locale pour Ã©viter un second clic
      setResults((prev) => prev.filter((u) => u.id !== profile_id));
    } catch (e: any) {
      setRmMsg(e?.message || "Erreur rÃ©seau.");
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Enseignants</h1>
        <p className="text-slate-600">
          CrÃ©er des comptes enseignants (mot de passe temporaire) et donner une
          discipline principale (optionnelle).
        </p>
      </div>

      {/* â”€â”€â”€â”€â”€ Carte 1 : CrÃ©ation enseignant â”€â”€â”€â”€â”€ */}
      <div className="rounded-2xl border bg-white p-5">
        <div className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-700">
          CrÃ©er un enseignant
        </div>
        <Help>
          TÃ©lÃ©phone <b>obligatoire</b> (pour la connexion). Email{" "}
          <b>facultatif</b>. La discipline est <b>optionnelle</b> (utile surtout
          au secondaire).
        </Help>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <div className="mb-1 text-xs text-slate-500">Nom affichÃ©</div>
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
            <div className="mb-1 text-xs text-slate-500">TÃ©lÃ©phone</div>
            <Input
              type="tel"
              value={tPhone}
              onChange={(e) => setTPhone(e.target.value)}
              placeholder="+225..."
              autoComplete="tel"
            />
          </div>
          <div>
            <div className="mb-1 text-xs text-slate-500">
              Discipline (optionnel)
            </div>
            <Input
              list="subjects-list"
              value={tSubject}
              onChange={(e) => setTSubject(e.target.value)}
              placeholder="MathÃ©matiques, FranÃ§aisâ€¦"
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
            {submitting ? "CrÃ©ationâ€¦" : "CrÃ©er lâ€™enseignant"}
          </Button>
        </div>
        {msg && <div className="mt-2 text-sm text-slate-600">{msg}</div>}
      </div>

      {/* â”€â”€â”€â”€â”€ Carte 2 : Retirer un enseignant â”€â”€â”€â”€â”€ */}
      <div className="rounded-2xl border bg-white p-5">
        <div className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-700">
          Retirer un enseignant de lâ€™Ã©tablissement
        </div>
        <Help>
          Recherchez lâ€™utilisateur par <b>nom</b>, <b>email</b> ou <b>tÃ©lÃ©phone</b>,
          puis cliquez sur <b>Retirer</b>. Lâ€™action enlÃ¨ve le rÃ´le <code>teacher</code> pour
          votre Ã©tablissement, clÃ´ture les sÃ©ances ouvertes et, si besoin, met{" "}
          <code>profiles.institution_id</code> Ã  <code>NULL</code> lorsquâ€™il pointait
          encore sur votre Ã©tablissement (ainsi, il ne voit plus vos classes).
        </Help>

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <div className="mb-1 text-xs text-slate-500">Recherche</div>
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Nom, email ou tÃ©lÃ©phone"
              onKeyDown={(e) => { if (e.key === "Enter") searchUsers(); }}
            />
          </div>
          <Button onClick={searchUsers} disabled={searching || !q.trim()}>
            {searching ? "Rechercheâ€¦" : "Rechercher"}
          </Button>
        </div>

        {/* RÃ©sultats */}
        <div className="mt-4 space-y-2">
          {results.length === 0 ? (
            <div className="text-sm text-slate-500">Aucun rÃ©sultat pour lâ€™instant.</div>
          ) : (
            results.map((u) => (
              <div key={u.id} className="flex items-center justify-between rounded-xl border p-3">
                <div className="min-w-0">
                  <div className="truncate font-medium">{u.display_name || "(Sans nom)"}</div>
                  <div className="text-xs text-slate-500 truncate">
                    {u.email || "â€”"} {u.phone ? `â€¢ ${u.phone}` : ""}{" "}
                    {u.role ? `â€¢ rÃ´le: ${u.role}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => removeTeacher(u.id)}
                    disabled={removingId === u.id}
                    className="rounded-xl bg-red-600 text-white px-3 py-1.5 text-sm font-medium shadow hover:bg-red-700 disabled:opacity-60"
                    title="Retirer le rÃ´le teacher pour cet Ã©tablissement"
                  >
                    {removingId === u.id ? "Retraitâ€¦" : "Retirer"}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {rmMsg && <div className="mt-3 text-sm text-slate-600">{rmMsg}</div>}
      </div>
    </div>
  );
}

// src/app/super/parametres/ui/SettingsPanel.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type Inst = { id: string; name: string; code_unique: string; subscription_expires_at: string | null };
type Admin = {
  profile_id: string;
  institution_id: string | null;
  profiles?: { display_name?: string | null; email?: string | null; phone?: string | null } | null;
};

function randomPass(len = 12) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@$%";
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

export default function SettingsPanel() {
  const sp = useSearchParams();
  const preselect = sp.get("inst") || "";

  const [insts, setInsts] = useState<Inst[]>([]);
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [inst, setInst] = useState<string>(preselect);
  const [admin, setAdmin] = useState<string>("");

  const currentInst = useMemo(() => insts.find(i => i.id === inst), [insts, inst]);

  // champs Ã©dition Ã©tablissement
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [expires, setExpires] = useState("");

  // reset password
  const [temp, setTemp] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function loadInsts() {
    const r = await fetch("/api/super/institutions?limit=200&offset=0", { cache: "no-store" });
    const j = await r.json();
    if (r.ok) setInsts(j.items || []);
  }
  async function loadAdmins() {
    const r = await fetch("/api/super/admins", { cache: "no-store" });
    const j = await r.json();
    if (r.ok) setAdmins((j.data || []).map((x: any) => ({
      profile_id: x.profile_id,
      institution_id: x.institution_id,
      profiles: Array.isArray(x.profiles) ? (x.profiles[0] ?? null) : (x.profiles ?? null),
    })));
  }

  useEffect(() => { loadInsts(); loadAdmins(); }, []);

  useEffect(() => {
    const ci = currentInst;
    if (ci) {
      setName(ci.name);
      setCode(ci.code_unique);
      setExpires(ci.subscription_expires_at || "");
    } else {
      setName(""); setCode(""); setExpires("");
    }
    setAdmin("");
    setMsg(null); setLink(null);
  }, [inst, insts]);

  const adminsOfInst = useMemo(
    () => admins.filter(a => a.institution_id === inst),
    [admins, inst]
  );

  async function saveInst() {
    if (!inst) return;
    setBusy(true); setMsg(null);
    const r = await fetch(`/api/super/institutions/${inst}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, code_unique: code, subscription_expires_at: expires || null }),
    });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) { setMsg(j?.error || "Ã‰chec de mise Ã  jour"); return; }
    setMsg("Ã‰tablissement mis Ã  jour.");
    await loadInsts();
  }

  async function genLink() {
    if (!admin) return;
    setBusy(true); setMsg(null); setLink(null);
    const r = await fetch(`/api/super/admins/${admin}/password`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "link" }) });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) { setMsg(j?.error || "Ã‰chec gÃ©nÃ©ration lien"); return; }
    setLink(j?.action_link || null);
    setMsg("Lien de rÃ©cupÃ©ration gÃ©nÃ©rÃ©.");
  }

  async function setTempPassword() {
    if (!admin) return;
    const pwd = temp || randomPass();
    setBusy(true); setMsg(null);
    const r = await fetch(`/api/super/admins/${admin}/password`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "temp", password: pwd }) });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) { setMsg(j?.error || "Ã‰chec changement mot de passe"); return; }
    setMsg(`Mot de passe temporaire dÃ©fini.`);
    setTemp(pwd); // on lâ€™affiche pour lâ€™admin
  }

  return (
    <div className="space-y-6">
      {/* Bloc Ã©dition Ã©tablissement */}
      <div className="rounded-2xl border bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-700">Modifier un Ã©tablissement</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <div className="mb-1 text-xs text-slate-500">Ã‰tablissement</div>
            <select value={inst} onChange={(e) => setInst(e.target.value)} className="w-full rounded-lg border bg-white px-3 py-2 text-sm">
              <option value="">â€” Choisir â€”</option>
              {insts.map(i => <option key={i.id} value={i.id}>{i.name} ({i.code_unique})</option>)}
            </select>
          </div>
          <div />
          <div>
            <div className="mb-1 text-xs text-slate-500">Nom</div>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" />
          </div>
          <div>
            <div className="mb-1 text-xs text-slate-500">Code unique</div>
            <input value={code} onChange={(e) => setCode(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" />
          </div>
          <div>
            <div className="mb-1 text-xs text-slate-500">Expire le (YYYY-MM-DD)</div>
            <input type="date" value={expires || ""} onChange={(e) => setExpires(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" />
          </div>
        </div>
        <div className="mt-3">
          <button onClick={saveInst} disabled={!inst || busy} className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {busy ? "Enregistrementâ€¦" : "Enregistrer"}
          </button>
        </div>
      </div>

      {/* Bloc rÃ©initialisation mot de passe admin */}
      <div className="rounded-2xl border bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-700">RÃ©initialiser mot de passe (admin)</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <div className="mb-1 text-xs text-slate-500">Admin de lâ€™Ã©tablissement</div>
            <select disabled={!inst} value={admin} onChange={(e) => setAdmin(e.target.value)} className="w-full rounded-lg border bg-white px-3 py-2 text-sm">
              <option value="">â€” Choisir â€”</option>
              {adminsOfInst.map(a => (
                <option key={a.profile_id} value={a.profile_id}>
                  {a.profiles?.display_name || a.profiles?.email || a.profile_id}
                </option>
              ))}
            </select>
          </div>
          <div />
          <div className="md:col-span-2 flex flex-wrap gap-2">
            <button onClick={genLink} disabled={!admin || busy} className="rounded-xl border px-4 py-2 text-sm">
              GÃ©nÃ©rer un lien de rÃ©cupÃ©ration
            </button>
            <input
              placeholder="Mot de passe temporaire (sinon gÃ©nÃ©rÃ©)"
              value={temp}
              onChange={(e) => setTemp(e.target.value)}
              className="w-64 rounded-lg border px-3 py-2 text-sm"
            />
            <button onClick={setTempPassword} disabled={!admin || busy} className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white">
              DÃ©finir un mot de passe temporaire
            </button>
          </div>
          {link && (
            <div className="md:col-span-2">
              <div className="mb-1 text-xs text-slate-500">Lien de rÃ©cupÃ©ration</div>
              <input value={link} readOnly className="w-full rounded-lg border px-3 py-2 text-sm" onFocus={(e) => e.currentTarget.select()} />
            </div>
          )}
        </div>
        {msg && <div className="mt-3 text-sm text-slate-700">{msg}</div>}
      </div>
    </div>
  );
}



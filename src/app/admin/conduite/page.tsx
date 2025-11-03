// src/app/admin/conduite/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

/* UI helpers */
function Select(p: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...p} className={"w-full rounded-lg border bg-white px-3 py-2 text-sm " + (p.className ?? "")} />;
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
function Input(p: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={"w-full rounded-lg border px-3 py-2 text-sm " + (p.className ?? "")} />;
}
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border bg-white p-5">
      <div className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-700">{title}</div>
      {children}
    </div>
  );
}

/* ─────────────────────────────────────────
   Helpers noms/prénoms
   - Affiche "Nom Prénom"
   - Fournit une clé de tri sur le NOM
────────────────────────────────────────── */
function splitNomPrenoms(full: string) {
  const s = (full ?? "").trim().replace(/\s+/g, " ");
  if (!s) return { nom: "", prenoms: "" };

  // Cas "Prenom, Nom"
  if (s.includes(",")) {
    const [prenoms, nom] = s.split(",").map((x) => x.trim());
    return { nom: nom ?? "", prenoms: prenoms ?? "" };
  }

  const parts = s.split(" ");
  if (parts.length === 1) return { nom: s, prenoms: "" };

  const last = parts[parts.length - 1];
  const rest = parts.slice(0, -1).join(" ");

  // Si 2 mots → inverser ; si dernier tout en majuscules → NOM
  const isUpper = /^[A-ZÀÂÄÇÉÈÊËÎÏÔÖÙÛÜŸ\-']+$/.test(last);
  if (parts.length === 2 || isUpper) return { nom: last, prenoms: rest };

  // Par défaut, dernier = NOM
  return { nom: last, prenoms: rest };
}

function nomPrenom(full: string) {
  const { nom, prenoms } = splitNomPrenoms(full);
  // const NOM = nom.toUpperCase(); // ← décommente si tu veux le NOM en majuscules
  return `${nom} ${prenoms}`.trim();
}

function nomKey(full: string) {
  const { nom } = splitNomPrenoms(full);
  return (nom || "").trim();
}

/* Types */
type ClassItem = { id: string; name: string; level: string };
type ConductItem = {
  student_id: string;
  full_name: string;
  breakdown: { assiduite: number; tenue: number; moralite: number; discipline: number };
  total: number;
  appreciation: string;
};

export default function ConduitePage() {
  // classes et filtres
  const [allClasses, setAllClasses] = useState<ClassItem[]>([]);
  const [level, setLevel] = useState("");
  const [classId, setClassId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  // données
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ConductItem[]>([]);
  const [classLabel, setClassLabel] = useState<string>("");

  // charger classes
  useEffect(() => {
    fetch("/api/admin/classes?limit=500", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setAllClasses(j.items || []))
      .catch(() => setAllClasses([]));
  }, []);

  const levels = useMemo(() => {
    const s = new Set<string>();
    for (const c of allClasses) if (c.level) s.add(c.level);
    return Array.from(s).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [allClasses]);

  const classesOfLevel = useMemo(
    () =>
      allClasses
        .filter((c) => !level || c.level === level)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    [allClasses, level]
  );

  useEffect(() => {
    setClassId("");
  }, [level]);

  async function validate() {
    if (!classId) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams({ class_id: classId });
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      const r = await fetch(`/api/admin/conduite/averages?${qs.toString()}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setItems(j.items || []);
      setClassLabel(j.class_label || "");
    } catch {
      setItems([]);
      setClassLabel("");
    } finally {
      setLoading(false);
    }
  }

  /* ✨ Tri alphabétique (A → Z) sur le NOM avec collateur FR */
  const sortedItems = useMemo(() => {
    const coll = new Intl.Collator("fr", { sensitivity: "base", ignorePunctuation: true });
    const list = [...items];
    list.sort((a, b) => {
      const ak = nomKey(a.full_name);
      const bk = nomKey(b.full_name);
      const byNom = coll.compare(ak, bk);
      if (byNom !== 0) return byNom;
      // Départage éventuel par prénoms ou nom complet formatté
      return coll.compare(nomPrenom(a.full_name), nomPrenom(b.full_name));
    });
    return list;
  }, [items]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Conduite — Moyennes par élève</h1>
        <p className="text-slate-600">
          Sélectionne un <b>niveau</b>, une <b>classe</b>, puis <i>Valider</i>. Les retraits automatiques sont appliqués.
        </p>
      </div>

      <Card title="Filtres">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
          <div>
            <div className="mb-1 text-xs text-slate-500">Du</div>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <div className="mb-1 text-xs text-slate-500">Au</div>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <div className="mb-1 text-xs text-slate-500">Niveau</div>
            <Select value={level} onChange={(e) => setLevel(e.target.value)}>
              <option value="">— Sélectionner un niveau —</option>
              {levels.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </Select>
          </div>
          <div className="md:col-span-2">
            <div className="mb-1 text-xs text-slate-500">Classe</div>
            <Select value={classId} onChange={(e) => setClassId(e.target.value)} disabled={!level}>
              <option value="">— Sélectionner une classe —</option>
              {classesOfLevel.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div className="mt-4">
          <Button onClick={validate} disabled={!classId || loading}>
            {loading ? "…" : "Valider"}
          </Button>
        </div>
      </Card>

      <Card title={classLabel ? `Classe — ${classLabel}` : "Résultats"}>
        {!classId ? (
          <div className="text-sm text-slate-600">—</div>
        ) : sortedItems.length === 0 ? (
          <div className="text-sm text-slate-600">{loading ? "Chargement…" : "Aucune donnée."}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left">Élève (tri par NOM)</th>
                  <th className="px-3 py-2 text-left">Assiduité (/6)</th>
                  <th className="px-3 py-2 text-left">Tenue (/3)</th>
                  <th className="px-3 py-2 text-left">Moralité (/4)</th>
                  <th className="px-3 py-2 text-left">Discipline (/7)</th>
                  <th className="px-3 py-2 text-left">Moyenne (/20)</th>
                </tr>
              </thead>
              <tbody>
                {sortedItems.map((it) => (
                  <tr key={it.student_id} className="border-t">
                    <td className="px-3 py-2">{nomPrenom(it.full_name)}</td>
                    <td className="px-3 py-2">{it.breakdown.assiduite.toFixed(2).replace(".", ",")}</td>
                    <td className="px-3 py-2">{it.breakdown.tenue.toFixed(2).replace(".", ",")}</td>
                    <td className="px-3 py-2">{it.breakdown.moralite.toFixed(2).replace(".", ",")}</td>
                    <td className="px-3 py-2">{it.breakdown.discipline.toFixed(2).replace(".", ",")}</td>
                    <td className="px-3 py-2 font-semibold">{it.total.toFixed(2).replace(".", ",")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

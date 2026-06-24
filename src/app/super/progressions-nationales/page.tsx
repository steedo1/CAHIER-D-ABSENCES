"use client";

import React, { useEffect, useMemo, useState } from "react";
import { BookOpen, CheckCircle2, Eye, FileText, Loader2, RefreshCw, Save, Upload, Wand2 } from "lucide-react";
import {
  extractStructuredItems,
  makeImportSample,
  parseImportLines,
  serializeImportLines,
  type StructuredProgressionItem,
} from "@/lib/textbook/import-assistant";


type NationalProgression = {
  id: string;
  title: string;
  academic_year: string;
  subject_name?: string | null;
  level?: string | null;
  series?: string | null;
  description?: string | null;
  status?: string | null;
  published_at?: string | null;
  document?: {
    original_name?: string | null;
    signed_url?: string | null;
  } | null;
  items?: Array<{ id: string }>;
};

type ProgressionItem = {
  id: string;
  item_type: string;
  title: string;
  rubric?: string | null;
  theme?: string | null;
  competency?: string | null;
  trimester?: string | null;
  month_label?: string | null;
  week_label?: string | null;
  planned_duration_minutes?: number | null;
  planned_sessions_count?: number | null;
  sort_order?: number | null;
};


const emptyForm = {
  title: "",
  academic_year: "",
  subject_name: "",
  level: "",
  series: "",
  description: "",
};

function classNames(...arr: Array<string | false | null | undefined>) {
  return arr.filter(Boolean).join(" ");
}


export default function SuperNationalProgressionsPage() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<NationalProgression[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [selectedItems, setSelectedItems] = useState<ProgressionItem[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [importText, setImportText] = useState(makeImportSample(null));
  const [rawProgressionText, setRawProgressionText] = useState("");
  const [assistantItems, setAssistantItems] = useState<StructuredProgressionItem[]>([]);
  const [assistantMessage, setAssistantMessage] = useState<string | null>(null);
  const [extractingOfficial, setExtractingOfficial] = useState(false);

  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) || null,
    [items, selectedId],
  );

  async function fetchJson(url: string, init?: RequestInit) {
    const res = await fetch(url, { cache: "no-store", credentials: "include", ...init });
    const json = await res.json().catch(() => null);
    if (!res.ok || json?.ok === false) {
      throw new Error(json?.details || json?.error || `Erreur HTTP ${res.status}`);
    }
    return json;
  }

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const json = await fetchJson("/api/super/textbook/national");
      setItems(json.items || []);
      setSelectedId((current) => current || json.items?.[0]?.id || "");
    } catch (e: any) {
      setError(e?.message || "Chargement impossible");
    } finally {
      setLoading(false);
    }
  }

  async function loadSelected(id: string) {
    if (!id) return;
    try {
      const json = await fetchJson(`/api/super/textbook/national/${id}/items`);
      setSelectedItems(json.items || []);
    } catch (e: any) {
      setError(e?.message || "Lignes indisponibles");
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    setSelectedItems([]);
    if (selectedId) loadSelected(selectedId);
  }, [selectedId]);

  useEffect(() => {
    if (!selected) return;
    setImportText(makeImportSample(selected));
  }, [selected?.id]);

  async function createProgression(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const fd = new FormData();
      fd.set("title", form.title);
      fd.set("academic_year", form.academic_year);
      fd.set("subject_name", form.subject_name);
      fd.set("level", form.level);
      fd.set("series", form.series);
      fd.set("description", form.description);
      fd.set("status", "active");
      if (documentFile) fd.set("document_file", documentFile);

      const json = await fetchJson("/api/super/textbook/national", { method: "POST", body: fd });
      setMessage("Progression nationale créée dans la bibliothèque globale Nexa.");
      setForm(emptyForm);
      setDocumentFile(null);
      await loadAll();
      if (json.item?.id) setSelectedId(json.item.id);
    } catch (e: any) {
      setError(e?.message || "Création impossible");
    } finally {
      setBusy(false);
    }
  }

  async function importItems() {
    if (!selected) return;
    const parsed = parseImportLines(importText);
    if (!parsed.length) {
      setError("Aucune ligne exploitable dans l’import.");
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await fetchJson(`/api/super/textbook/national/${selected.id}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: parsed, replace: true }),
      });
      setMessage(`${parsed.length} ligne(s) importée(s) dans le modèle national.`);
      await loadAll();
      await loadSelected(selected.id);
    } catch (e: any) {
      setError(e?.message || "Import impossible");
    } finally {
      setBusy(false);
    }
  }


  function runAssistantExtraction() {
    const extracted = extractStructuredItems(rawProgressionText, selected || undefined);
    setAssistantItems(extracted);

    if (!rawProgressionText.trim()) {
      setAssistantMessage("Colle d'abord le texte extrait de la progression ou importe un fichier TXT/CSV.");
      return;
    }

    if (!extracted.length) {
      setAssistantMessage("Aucune ligne exploitable détectée. Il faudra corriger le texte ou utiliser le modèle structuré.");
      return;
    }

    setAssistantMessage(`${extracted.length} ligne(s) détectée(s). Vérifie l'aperçu avant d'importer.`);
  }

  function useAssistantPreview() {
    if (!assistantItems.length) {
      setAssistantMessage("Lance d'abord l'extraction assistée pour générer une prévisualisation.");
      return;
    }
    setImportText(serializeImportLines(assistantItems));
    setAssistantMessage("Prévisualisation copiée dans la zone d'import. Tu peux encore corriger avant validation.");
  }

  async function readStructuredFile(file: File | null) {
    if (!file) return;
    const name = file.name.toLowerCase();
    const isTextLike = file.type.startsWith("text/") || name.endsWith(".txt") || name.endsWith(".csv") || name.endsWith(".tsv");

    if (!isTextLike) {
      setAssistantMessage(
        "Ce bouton lit les fichiers TXT/CSV déjà structurés. Pour exploiter le PDF officiel uploadé, clique plutôt sur “Extraire depuis le fichier officiel”.",
      );
      return;
    }

    const text = await file.text();
    setRawProgressionText(text);
    const extracted = extractStructuredItems(text, selected || undefined);
    setAssistantItems(extracted);
    setAssistantMessage(`${extracted.length} ligne(s) détectée(s) depuis le fichier.`);
  }

  async function extractFromOfficialDocument() {
    if (!selected) return;
    if (!selected.document?.signed_url) {
      setAssistantMessage("Aucun fichier officiel n'est attaché à cette progression nationale.");
      return;
    }

    setExtractingOfficial(true);
    setError(null);
    setAssistantMessage(null);
    try {
      const json = await fetchJson(`/api/super/textbook/national/${selected.id}/extract`, { method: "POST" });
      const rawText = String(json.raw_text || "");
      const extracted = Array.isArray(json.items) ? json.items : [];
      setRawProgressionText(rawText);
      setAssistantItems(extracted);
      setImportText(json.import_text || serializeImportLines(extracted));

      const warning = json.warning === "pdf_fallback" ? " Extraction PDF réalisée en mode secours : vérifie bien les lignes." : "";
      setAssistantMessage(`${extracted.length} ligne(s) détectée(s) depuis le fichier officiel.${warning}`);
    } catch (e: any) {
      setAssistantItems([]);
      setAssistantMessage(e?.message || "Extraction du fichier officiel impossible.");
    } finally {
      setExtractingOfficial(false);
    }
  }

  return (
    <div className="space-y-6">
      <header className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-violet-600">Nexa · Super Admin</p>
            <h1 className="mt-2 text-2xl font-black text-slate-900">Progressions nationales</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">
              Alimente la bibliothèque globale. Les établissements y copieront ensuite les progressions valides,
              sans modifier la source nationale.
            </p>
          </div>
          <button
            type="button"
            onClick={loadAll}
            disabled={loading || busy}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Actualiser
          </button>
        </div>
      </header>

      {message ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">{message}</div> : null}
      {error ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div> : null}

      <div className="grid gap-6 xl:grid-cols-[420px_1fr]">
        <section className="space-y-6">
          <form onSubmit={createProgression} className="rounded-2xl border bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-violet-50 text-violet-700">
                <BookOpen className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-black text-slate-900">Ajouter un modèle national</h2>
                <p className="text-xs text-slate-500">Source globale Nexa, indépendante des écoles.</p>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              <input className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold outline-none focus:border-violet-400" placeholder="Titre : Progression nationale Anglais 2nde A-C" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} required />
              <div className="grid grid-cols-2 gap-3">
                <input className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold outline-none focus:border-violet-400" placeholder="Année : 2026-2027" value={form.academic_year} onChange={(e) => setForm((f) => ({ ...f, academic_year: e.target.value }))} required />
                <input className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold outline-none focus:border-violet-400" placeholder="Niveau : 2nde A-C" value={form.level} onChange={(e) => setForm((f) => ({ ...f, level: e.target.value }))} required />
              </div>
              <input className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold outline-none focus:border-violet-400" placeholder="Discipline : Anglais" value={form.subject_name} onChange={(e) => setForm((f) => ({ ...f, subject_name: e.target.value }))} required />
              <input className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold outline-none focus:border-violet-400" placeholder="Série / option si nécessaire" value={form.series} onChange={(e) => setForm((f) => ({ ...f, series: e.target.value }))} />
              <textarea className="h-24 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold outline-none focus:border-violet-400" placeholder="Description / source officielle" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
              <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-violet-200 bg-violet-50 px-4 py-3 text-sm font-bold text-slate-700">
                <Upload className="h-4 w-4" />
                <span>{documentFile ? documentFile.name : "Joindre le fichier officiel national"}</span>
                <input className="hidden" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.csv" onChange={(e) => setDocumentFile(e.target.files?.[0] || null)} />
              </label>
              <button disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-violet-700 px-4 py-3 text-sm font-black text-white disabled:opacity-60">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Publier dans la bibliothèque nationale
              </button>
            </div>
          </form>

          <section className="rounded-2xl border bg-white p-5 shadow-sm">
            <h2 className="text-lg font-black text-slate-900">Bibliothèque nationale</h2>
            <p className="mt-1 text-xs text-slate-500">Modèles visibles par les établissements après publication.</p>
            <div className="mt-4 space-y-2">
              {items.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedId(p.id)}
                  className={classNames(
                    "w-full rounded-2xl border p-3 text-left transition",
                    selectedId === p.id ? "border-violet-200 bg-violet-50" : "border-slate-200 bg-white hover:bg-slate-50",
                  )}
                >
                  <div className="text-sm font-black text-slate-900">{p.title}</div>
                  <div className="mt-1 text-xs font-bold text-slate-500">
                    {p.subject_name || "Discipline"} · {p.level || "Niveau"} · {p.academic_year}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-black">
                    <span className="rounded-full bg-white px-2 py-1 text-violet-700 ring-1 ring-violet-100">{p.status || "active"}</span>
                    <span className="rounded-full bg-white px-2 py-1 text-slate-600 ring-1 ring-slate-200">{p.items?.length || 0} lignes</span>
                  </div>
                </button>
              ))}
              {!items.length && !loading ? (
                <div className="rounded-2xl bg-slate-50 p-4 text-sm font-bold text-slate-500">Aucun modèle national pour le moment.</div>
              ) : null}
            </div>
          </section>
        </section>

        <section className="space-y-6">
          <section className="rounded-2xl border bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="text-lg font-black text-slate-900">Lignes cliquables</h2>
                <p className="mt-1 text-sm text-slate-600">
                  {selected ? selected.title : "Sélectionne un modèle national pour importer ses unités, leçons et séances."}
                </p>
              </div>
              {selected?.document?.signed_url ? (
                <a href={selected.document.signed_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
                  <FileText className="h-4 w-4" /> Fichier officiel
                </a>
              ) : null}
            </div>

            {selected ? (
              <div className="mt-5 space-y-5">
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  <div className="font-black">Important</div>
                  <p className="mt-1 font-semibold">
                    Le fichier officiel reste la preuve documentaire. Les statistiques, les leçons cliquables et les séances viennent des lignes structurées ci-dessous.
                  </p>
                </div>

                <div className="rounded-2xl border border-violet-100 bg-violet-50/50 p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <h3 className="inline-flex items-center gap-2 text-base font-black text-slate-900">
                        <Wand2 className="h-4 w-4 text-violet-700" /> Assistant de structuration
                      </h3>
                      <p className="mt-1 text-sm font-semibold text-slate-600">
                        Clique sur “Extraire depuis le fichier officiel” pour tenter de lire le document uploadé. Tu peux aussi coller un texte brut ou importer un TXT/CSV déjà préparé.
                      </p>
                    </div>
                    <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-violet-200 bg-white px-3 py-2 text-xs font-black text-violet-700 hover:bg-violet-50">
                      <Upload className="h-4 w-4" /> TXT / CSV
                      <input className="hidden" type="file" accept=".txt,.csv,.tsv,text/plain,text/csv" onChange={(e) => readStructuredFile(e.target.files?.[0] || null)} />
                    </label>
                  </div>

                  <textarea
                    className="mt-4 h-36 w-full rounded-2xl border border-violet-100 bg-white px-4 py-3 text-xs font-semibold text-slate-700 outline-none focus:border-violet-400"
                    placeholder="Le texte extrait du fichier officiel apparaîtra ici. Tu peux aussi coller le texte brut de la progression officielle."
                    value={rawProgressionText}
                    onChange={(e) => setRawProgressionText(e.target.value)}
                  />

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={extractFromOfficialDocument} disabled={extractingOfficial || !selected?.document?.signed_url} className="inline-flex items-center gap-2 rounded-xl bg-violet-700 px-4 py-2 text-xs font-black text-white disabled:opacity-50">
                      {extractingOfficial ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />} Extraire depuis le fichier officiel
                    </button>
                    <button type="button" onClick={runAssistantExtraction} className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-xs font-black text-violet-700 ring-1 ring-violet-200">
                      <Eye className="h-4 w-4" /> Prévisualiser le texte collé
                    </button>
                    <button type="button" onClick={useAssistantPreview} disabled={!assistantItems.length} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-xs font-black text-white disabled:opacity-50">
                      <CheckCircle2 className="h-4 w-4" /> Utiliser cette prévisualisation
                    </button>
                  </div>

                  {assistantMessage ? (
                    <div className="mt-3 rounded-xl bg-white px-3 py-2 text-xs font-bold text-slate-700 ring-1 ring-violet-100">{assistantMessage}</div>
                  ) : null}

                  {assistantItems.length ? (
                    <div className="mt-4 overflow-hidden rounded-2xl border border-violet-100 bg-white">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-violet-50 text-[11px] uppercase tracking-wide text-violet-700">
                          <tr>
                            <th className="px-3 py-2">Ordre</th>
                            <th className="px-3 py-2">Type</th>
                            <th className="px-3 py-2">Titre détecté</th>
                            <th className="px-3 py-2">Durée / séances</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-violet-50">
                          {assistantItems.slice(0, 12).map((item, index) => (
                            <tr key={`${item.sort_order}-${index}`}>
                              <td className="px-3 py-2 font-bold text-slate-500">{item.sort_order}</td>
                              <td className="px-3 py-2 font-black text-violet-700">{item.item_type}</td>
                              <td className="px-3 py-2">
                                <div className="font-bold text-slate-900">{item.title}</div>
                                <div className="text-[11px] text-slate-500">{item.rubric || item.theme || item.competency || ""}</div>
                              </td>
                              <td className="px-3 py-2 font-bold text-slate-500">
                                {item.planned_duration_minutes ? `${item.planned_duration_minutes} min` : "—"}
                                {item.planned_sessions_count ? ` · ${item.planned_sessions_count} séance(s)` : ""}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {assistantItems.length > 12 ? (
                        <div className="border-t border-violet-50 px-3 py-2 text-xs font-bold text-slate-500">+ {assistantItems.length - 12} autre(s) ligne(s) détectée(s)</div>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-black text-slate-900">Import structuré final</h3>
                      <p className="text-xs font-semibold text-slate-500">Corrige ici avant de remplacer les lignes nationales.</p>
                    </div>
                  </div>
                  <textarea className="h-64 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-xs outline-none focus:border-violet-400" value={importText} onChange={(e) => setImportText(e.target.value)} />
                </div>

                <button type="button" onClick={importItems} disabled={busy} className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-black text-white disabled:opacity-60">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  Remplacer / importer les lignes nationales
                </button>
              </div>
            ) : null}
          </section>

          <section className="rounded-2xl border bg-white p-5 shadow-sm">
            <h2 className="text-lg font-black text-slate-900">Aperçu des lignes publiées</h2>
            <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-3">Ordre</th>
                    <th className="px-3 py-3">Type</th>
                    <th className="px-3 py-3">Titre</th>
                    <th className="px-3 py-3">Période</th>
                    <th className="px-3 py-3">Durée</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {selectedItems.map((item) => (
                    <tr key={item.id} className="align-top">
                      <td className="px-3 py-3 text-xs font-bold text-slate-500">{item.sort_order ?? ""}</td>
                      <td className="px-3 py-3 text-xs font-black text-violet-700">{item.item_type}</td>
                      <td className="px-3 py-3">
                        <div className="font-bold text-slate-900">{item.title}</div>
                        <div className="text-xs text-slate-500">{[item.rubric, item.theme, item.competency].filter(Boolean).join(" · ")}</div>
                      </td>
                      <td className="px-3 py-3 text-xs font-bold text-slate-500">{[item.trimester, item.month_label, item.week_label].filter(Boolean).join(" · ")}</td>
                      <td className="px-3 py-3 text-xs font-bold text-slate-500">{item.planned_duration_minutes ? `${item.planned_duration_minutes} min` : "—"}{item.planned_sessions_count ? ` · ${item.planned_sessions_count} séance(s)` : ""}</td>
                    </tr>
                  ))}
                  {!selectedItems.length ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-8 text-center text-sm font-bold text-slate-500">
                        Aucune ligne publiée pour ce modèle.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </section>
      </div>
    </div>
  );
}

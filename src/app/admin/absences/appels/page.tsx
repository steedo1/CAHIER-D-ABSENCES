"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Filter,
  RefreshCw,
  Search,
  Bell,
  BellOff,
  Loader2,
  FileText,
} from "lucide-react";

// ✅ PDF
import jsPDF from "jspdf";
import "jspdf-autotable";

type MonitorStatus = "missing" | "late" | "ok";

type MonitorRow = {
  id: string;
  date: string; // "YYYY-MM-DD"
  weekday_label?: string | null;
  period_label?: string | null;
  planned_start?: string | null;
  planned_end?: string | null;
  class_label?: string | null;
  subject_name?: string | null;
  teacher_name: string;
  status: MonitorStatus;
  late_minutes?: number | null;
  opened_from?: "teacher" | "class_device" | null;
};

type FetchState<T> = { loading: boolean; error: string | null; data: T | null };

type PushStatus = "idle" | "subscribing" | "enabled" | "denied" | "error";

const VAPID_PUBLIC_KEY =
  (typeof process !== "undefined"
    ? process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
    : "") || "";

/* ───────── Helpers ───────── */
function toLocalDateInputValue(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function dateHumanFR(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("fr-FR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  });
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");

  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function Input(p: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...p}
      className={[
        "w-full rounded-xl border border-slate-200 bg-white/90 px-3 py-2 text-sm",
        "shadow-sm outline-none transition",
        "focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/20",
        "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400",
        p.className ?? "",
      ].join(" ")}
    />
  );
}

function Select(p: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...p}
      className={[
        "w-full rounded-xl border border-slate-200 bg-white/90 px-3 py-2 text-sm",
        "shadow-sm outline-none transition",
        "focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/20",
        "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400",
        p.className ?? "",
      ].join(" ")}
    />
  );
}

function Button(p: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...p}
      className={[
        "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium",
        "bg-emerald-600 text-white shadow-sm hover:bg-emerald-700",
        "focus:outline-none focus:ring-4 focus:ring-emerald-500/30",
        "disabled:opacity-60 disabled:cursor-not-allowed",
        p.className ?? "",
      ].join(" ")}
    />
  );
}

/* ───────── Page ───────── */

export default function SurveillanceAppelsPage() {
  const [from, setFrom] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return toLocalDateInputValue(d);
  });
  const [to, setTo] = useState<string>(() => toLocalDateInputValue(new Date()));
  const [statusFilter, setStatusFilter] = useState<MonitorStatus | "all">("all");
  const [teacherQuery, setTeacherQuery] = useState<string>("");

  const [rowsState, setRowsState] = useState<FetchState<MonitorRow[]>>({
    loading: false,
    error: null,
    data: null,
  });

  // ───────── Etat push admin ─────────
  const [pushSupported, setPushSupported] = useState(false);
  const [pushStatus, setPushStatus] = useState<PushStatus>("idle");
  const [pushError, setPushError] = useState<string | null>(null);

  // Vérifier support + subscription existante
  useEffect(() => {
    if (typeof window === "undefined") return;

    const hasNotif = "Notification" in window;
    const hasSW = "serviceWorker" in navigator;
    const hasPush = "PushManager" in (window as any);

    if (!hasNotif || !hasSW || !hasPush) {
      setPushSupported(false);
      setPushStatus("error");
      setPushError(
        "Les notifications push ne sont pas supportées sur ce navigateur ou cet appareil."
      );
      return;
    }

    setPushSupported(true);

    if (Notification.permission === "denied") {
      setPushStatus("denied");
      setPushError(
        "Les notifications sont bloquées pour ce site dans votre navigateur. Utilisez l’icône cadenas à côté de l’adresse pour les réactiver."
      );
      return;
    }

    (async () => {
      try {
        const reg =
          (await navigator.serviceWorker.getRegistration()) ||
          (await navigator.serviceWorker.register("/sw.js"));
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          setPushStatus("enabled");
        }
      } catch (e) {
        console.warn("[SurveillanceAppels] push init error", e);
      }
    })();
  }, []);

  async function enablePush() {
    setPushError(null);

    if (typeof window === "undefined") {
      setPushStatus("error");
      setPushError("Contexte navigateur requis pour activer les notifications.");
      return;
    }

    const hasNotif = "Notification" in window;
    const hasSW = "serviceWorker" in navigator;
    const hasPush = "PushManager" in (window as any);

    if (!hasNotif || !hasSW || !hasPush) {
      setPushSupported(false);
      setPushStatus("error");
      setPushError(
        "Les notifications push ne sont pas supportées sur ce navigateur ou cet appareil."
      );
      return;
    }

    if (!VAPID_PUBLIC_KEY) {
      setPushError("Clé VAPID non configurée côté client.");
      setPushStatus("error");
      return;
    }

    try {
      setPushStatus("subscribing");

      let permission = Notification.permission;

      if (permission === "denied") {
        setPushStatus("denied");
        setPushError(
          "Les notifications sont bloquées pour ce site dans votre navigateur. Utilisez l’icône cadenas à côté de l’adresse pour les réactiver."
        );
        return;
      }

      if (permission === "default") {
        permission = await Notification.requestPermission();
      }

      if (permission !== "granted") {
        setPushStatus("denied");
        setPushError(
          "Les notifications ont été refusées pour ce navigateur. Vous pouvez les réactiver dans les paramètres du navigateur."
        );
        return;
      }

      let reg = await navigator.serviceWorker.getRegistration();
      if (!reg) {
        reg = await navigator.serviceWorker.register("/sw.js");
      }
      if (!reg) {
        throw new Error(
          "Impossible de récupérer le service worker (aucun enregistrement trouvé)."
        );
      }

      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
      }

      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          platform: "web",
          device_id: sub.endpoint,
          subscription: sub,
        }),
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(
          `Échec d'enregistrement du device push (HTTP ${res.status}) ${
            txt || ""
          }`
        );
      }

      setPushStatus("enabled");
      setPushError(null);
    } catch (e: any) {
      console.error("[SurveillanceAppels] enablePush error", e);
      setPushStatus("error");
      setPushError(
        e?.message ||
          "Erreur lors de l’activation des notifications. Vérifiez le HTTPS et le service worker."
      );
    } finally {
      setPushStatus((prev) => (prev === "subscribing" ? "idle" : prev));
    }
  }

  async function loadRows() {
    if (!from || !to) return;
    setRowsState({ loading: true, error: null, data: null });
    try {
      const qs = new URLSearchParams({ from, to });
      const res = await fetch(`/api/admin/attendance/monitor?${qs.toString()}`, {
        cache: "no-store",
      });

      if (!res.ok) {
        throw new Error(
          `API /api/admin/attendance/monitor non disponible (HTTP ${res.status}).`
        );
      }
      const json = await res.json().catch(() => null);
      const rows = (json?.rows || []) as MonitorRow[];
      setRowsState({ loading: false, error: null, data: rows });
    } catch (e: any) {
      setRowsState({
        loading: false,
        error: e?.message || "Erreur lors du chargement des données.",
        data: null,
      });
    }
  }

  useEffect(() => {
    loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  const rows = rowsState.data || [];

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (
        teacherQuery.trim() &&
        !r.teacher_name
          .toLowerCase()
          .includes(teacherQuery.trim().toLowerCase())
      ) {
        return false;
      }
      return true;
    });
  }, [rows, statusFilter, teacherQuery]);

  const totalMissing = rows.filter((r) => r.status === "missing").length;
  const totalLate = rows.filter((r) => r.status === "late").length;
  const totalOk = rows.filter((r) => r.status === "ok").length;

  function setToday() {
    const today = toLocalDateInputValue(new Date());
    setFrom(today);
    setTo(today);
  }

  function setThisWeek() {
    const today = new Date();
    const day = today.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const monday = new Date(today);
    monday.setDate(today.getDate() + diff);
    setFrom(toLocalDateInputValue(monday));
    setTo(toLocalDateInputValue(today));
  }

  function statusBadge(r: MonitorRow) {
    if (r.status === "missing") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 border border-red-200">
          <AlertTriangle className="h-3 w-3" />
          Appel manquant
        </span>
      );
    }
    if (r.status === "late") {
      const mins = typeof r.late_minutes === "number" ? r.late_minutes : null;
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 border border-amber-200">
          <Clock className="h-3 w-3" />
          Appel en retard {mins !== null && mins >= 0 ? `( +${mins} min )` : ""}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 border border-emerald-200">
        <CheckCircle2 className="h-3 w-3" />
        OK
      </span>
    );
  }

  function originEmoji(o?: "teacher" | "class_device" | null) {
    if (o === "class_device") return "🖥️";
    if (o === "teacher") return "📱";
    return "";
  }

  /* ───────── Export PDF — Synthèse + grand tableau ───────── */
  function exportPdf() {
    if (!filteredRows.length) return;

    try {
      // On part en paysage pour caser toutes les colonnes
      const doc = new jsPDF({
        orientation: "landscape",
        unit: "mm",
        format: "a4",
      });

      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const marginLeft = 14;
      const marginRight = 14;
      const centerX = pageWidth / 2;

      /* ───── PAGE 1 : SYNTHÈSE ───── */
      let y = 18;

      doc.setFontSize(16);
      doc.setFont("helvetica", "bold");
      doc.text(
        "Surveillance des appels — Synthèse",
        centerX,
        y,
        { align: "center" }
      );

      y += 8;
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.text(`Période : ${from} → ${to}`, marginLeft, y);
      y += 5;

      const statusLabelPdf =
        statusFilter === "all"
          ? "Tous les statuts"
          : statusFilter === "missing"
          ? "Appels manquants"
          : statusFilter === "late"
          ? "Appels en retard"
          : "Appels conformes";

      const teacherLabelPdf = teacherQuery.trim()
        ? teacherQuery.trim()
        : "Tous les enseignants";

      doc.text(`Filtre statut : ${statusLabelPdf}`, marginLeft, y);
      y += 5;
      doc.text(`Filtre enseignant : ${teacherLabelPdf}`, marginLeft, y);

      y += 6;
      doc.setDrawColor(220);
      doc.line(marginLeft, y, pageWidth - marginRight, y);
      y += 6;

      const totalSessions = filteredRows.length;
      const missingCount = filteredRows.filter(
        (r) => r.status === "missing"
      ).length;
      const lateCount = filteredRows.filter(
        (r) => r.status === "late"
      ).length;
      const okCount = filteredRows.filter((r) => r.status === "ok").length;

      const pct = (n: number) =>
        totalSessions
          ? `${((n * 100) / totalSessions).toFixed(1).replace(".", ",")} %`
          : "—";

      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.text("Chiffres clés sur la sélection", marginLeft, y);
      y += 5;
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.text(`Nombre total de créneaux : ${totalSessions}`, marginLeft, y);
      y += 5;
      doc.text(
        `Appels manquants : ${missingCount} (${pct(missingCount)})`,
        marginLeft,
        y
      );
      y += 5;
      doc.text(
        `Appels en retard : ${lateCount} (${pct(lateCount)})`,
        marginLeft,
        y
      );
      y += 5;
      doc.text(
        `Appels conformes : ${okCount} (${pct(okCount)})`,
        marginLeft,
        y
      );

      y += 10;
      doc.setFontSize(9);
      doc.text(
        "La page suivante présente le détail de chaque créneau sous forme de tableau.",
        marginLeft,
        y
      );

      const footerY1 = pageHeight - 12;
      doc.setFontSize(8);
      doc.setTextColor(120);
      doc.text(
        "Document généré automatiquement par Mon Cahier — Surveillance des appels",
        marginLeft,
        footerY1
      );
      doc.text("Page 1 / 2+", centerX, footerY1, { align: "center" });

      /* ───── PAGES SUIVANTES : TABLEAU COMPLET ───── */
      doc.addPage();

      const head = [
        "Date",
        "Heure / créneau",
        "Classe",
        "Discipline",
        "Enseignant",
        "Statut",
        "Origine",
      ];

      const body = filteredRows.map((r) => {
        const period =
          r.period_label ??
          (r.planned_start && r.planned_end
            ? `${r.planned_start} – ${r.planned_end}`
            : "—");

        const statusText =
          r.status === "missing"
            ? "Manquant"
            : r.status === "late"
            ? `En retard${
                typeof r.late_minutes === "number"
                  ? ` (+${r.late_minutes} min)`
                  : ""
              }`
            : "OK";

        const originText =
          r.opened_from === "class_device"
            ? "Appareil classe"
            : r.opened_from === "teacher"
            ? "Compte enseignant"
            : "";

        return [
          dateHumanFR(r.date),
          period,
          r.class_label || "—",
          r.subject_name || "Discipline non renseignée",
          r.teacher_name || "—",
          statusText,
          originText,
        ];
      });

      (doc as any).autoTable({
        head: [head],
        body,
        startY: 24,
        styles: { fontSize: 7, cellPadding: 1.5, valign: "middle" },
        headStyles: {
          fontStyle: "bold",
          halign: "center",
          fillColor: [15, 23, 42],
          textColor: 255,
        },
        columnStyles: {
          0: { cellWidth: 24 },
          1: { cellWidth: 32 },
          2: { cellWidth: 24 },
          3: { cellWidth: 60 },
          4: { cellWidth: 44 },
          // 5 & 6 laissent AutoTable gérer la largeur restante
        },
        margin: { left: marginLeft, right: marginRight, top: 24, bottom: 16 },
        didDrawPage: (data: any) => {
          const pw = doc.internal.pageSize.getWidth();
          const ph = doc.internal.pageSize.getHeight();
          const cx = pw / 2;

          doc.setFontSize(12);
          doc.setFont("helvetica", "bold");
          doc.setTextColor(0);
          doc.text(
            "Surveillance des appels — Détail des créneaux",
            cx,
            14,
            { align: "center" }
          );

          doc.setFontSize(9);
          doc.setFont("helvetica", "normal");
          doc.text(`Période : ${from} → ${to}`, marginLeft, 18);

          const pageNumber = data.pageNumber;
          const totalPages = (doc as any).getNumberOfPages?.() ?? pageNumber;
          const footerY = ph - 10;

          doc.setFontSize(8);
          doc.setTextColor(120);
          doc.text(
            "Document généré automatiquement par Mon Cahier — Surveillance des appels",
            marginLeft,
            footerY
          );
          doc.text(
            `Page ${pageNumber} / ${totalPages}`,
            cx,
            footerY,
            { align: "center" }
          );
        },
      });

      const filename = `surveillance_appels_${from}_${to}.pdf`;
      doc.save(filename);
    } catch (err) {
      console.error("[SurveillanceAppels] exportPdf error", err);
      alert(
        "Export PDF indisponible. Vérifiez que les librairies jsPDF et jspdf-autotable sont bien installées."
      );
    }
  }

  /* ───────── UI ───────── */

  return (
    <main className="min-h-screen bg-slate-50/80 p-4 md:p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Header */}
        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600">
              Tableau de contrôle
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-slate-900">
              Surveillance des appels
            </h1>
            <p className="mt-1 text-sm text-slate-500 max-w-2xl">
              Repérez en temps réel les{" "}
              <span className="font-medium text-red-600">
                appels manquants
              </span>{" "}
              et les{" "}
              <span className="font-medium text-amber-600">
                appels réalisés en retard
              </span>{" "}
              par rapport aux emplois du temps officiels.
            </p>
          </div>
        </header>

        {/* Bloc activation notifications admin */}
        <section className="rounded-2xl border border-sky-200 bg-gradient-to-r from-sky-50 to-emerald-50 shadow-sm p-4 md:p-5 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            {pushStatus === "enabled" ? (
              <div className="mt-0.5 inline-flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 shadow-sm">
                <Bell className="h-5 w-5" />
              </div>
            ) : (
              <div className="mt-0.5 inline-flex h-10 w-10 items-center justify-center rounded-full bg-sky-100 text-sky-700 shadow-sm">
                <BellOff className="h-5 w-5" />
              </div>
            )}
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-slate-900">
                Notifications instantanées pour les appels manquants
              </h2>
              <p className="text-xs text-slate-700">
                Activez les notifications push pour être alerté(e) automatiquement{" "}
                dès qu&apos;un appel est <strong>manquant</strong> ou réalisé{" "}
                <strong>hors délai</strong>, selon la fenêtre de contrôle définie.
              </p>
              {!pushSupported && (
                <p className="text-[11px] text-red-700">
                  Les notifications ne sont pas supportées sur ce navigateur.
                  Essayez depuis un navigateur récent (Chrome, Edge, Firefox) sur
                  ordinateur ou mobile.
                </p>
              )}
              {pushError && (
                <p className="text-[11px] text-red-700">{pushError}</p>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2 text-right">
            <span className="text-[11px] uppercase tracking-wide text-slate-500">
              Statut
            </span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                onClick={enablePush}
                disabled={
                  !pushSupported ||
                  pushStatus === "subscribing" ||
                  pushStatus === "enabled"
                }
                className={[
                  "!px-4",
                  pushStatus === "enabled"
                    ? "bg-emerald-600 hover:bg-emerald-700"
                    : "bg-slate-900 hover:bg-black",
                ].join(" ")}
              >
                {pushStatus === "subscribing" && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                {pushStatus === "enabled"
                  ? "Notifications activées sur cet appareil"
                  : "Activer les notifications"}
              </Button>
            </div>
          </div>
        </section>

        {/* Résumé / KPIs */}
        <section className="grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-red-100 bg-red-50/80 p-4 shadow-sm flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-red-800 uppercase tracking-wide">
                Appels manquants
              </span>
              <AlertTriangle className="h-5 w-5 text-red-500" />
            </div>
            <div className="text-2xl font-semibold text-red-900">
              {totalMissing}
            </div>
            <p className="text-[11px] text-red-800/80">
              Créneaux où un cours était prévu mais aucun appel n&apos;a été
              détecté dans la fenêtre de contrôle.
            </p>
          </div>

          <div className="rounded-2xl border border-amber-100 bg-amber-50/80 p-4 shadow-sm flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-amber-900 uppercase tracking-wide">
                Appels en retard
              </span>
              <Clock className="h-5 w-5 text-amber-500" />
            </div>
            <div className="text-2xl font-semibold text-amber-900">
              {totalLate}
            </div>
            <p className="text-[11px] text-amber-900/80">
              Appels effectués, mais avec un retard supérieur au seuil paramétré
              (ex. 15 minutes).
            </p>
          </div>

          <div className="rounded-2xl border border-emerald-100 bg-emerald-50/80 p-4 shadow-sm flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-emerald-900 uppercase tracking-wide">
                Appels conformes
              </span>
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            </div>
            <div className="text-2xl font-semibold text-emerald-900">
              {totalOk}
            </div>
            <p className="text-[11px] text-emerald-900/80">
              Créneaux où l’appel a été réalisé dans les délais prévus.
            </p>
          </div>
        </section>

        {/* Filtres */}
        <section className="rounded-2xl border border-slate-200 bg-white/90 shadow-sm p-4 md:p-5 space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <Filter className="h-4 w-4 text-slate-500" />
              <span>Filtres de période et de statut</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <Button
                type="button"
                className="!px-3 !py-1.5 bg-slate-800 hover:bg-slate-900"
                onClick={setToday}
              >
                Aujourd&apos;hui
              </Button>
              <Button
                type="button"
                className="!px-3 !py-1.5 bg-slate-800 hover:bg-slate-900"
                onClick={setThisWeek}
              >
                Cette semaine
              </Button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">
                Date de début
              </label>
              <Input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">
                Date de fin
              </label>
              <Input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">
                Statut
              </label>
              <Select
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(e.target.value as MonitorStatus | "all")
                }
              >
                <option value="all">Tous les statuts</option>
                <option value="missing">Appels manquants</option>
                <option value="late">Appels en retard</option>
                <option value="ok">Appels conformes</option>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">
                Filtrer par enseignant
              </label>
              <div className="relative">
                <Input
                  type="text"
                  placeholder="Nom de l’enseignant"
                  value={teacherQuery}
                  onChange={(e) => setTeacherQuery(e.target.value)}
                  className="pl-8"
                />
                <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between text-xs text-slate-500">
            <span>
              Période active : <strong>{from}</strong> → <strong>{to}</strong>
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={loadRows}
                className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
              >
                <RefreshCw className="h-3 w-3" />
                Actualiser
              </button>
              <button
                type="button"
                onClick={exportPdf}
                disabled={!filteredRows.length}
                className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <FileText className="h-3 w-3" />
                Export PDF
              </button>
            </div>
          </div>

          {/* Légende statuts */}
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
            <span className="mr-1">Légende :</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 border border-red-100 text-red-700">
              <AlertTriangle className="h-3 w-3" /> Appel manquant
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 border border-amber-100 text-amber-800">
              <Clock className="h-3 w-3" /> Appel en retard
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 border border-emerald-100 text-emerald-800">
              <CheckCircle2 className="h-3 w-3" /> Appel conforme
            </span>
          </div>
        </section>

        {/* Tableau principal */}
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4 md:p-5">
          {rowsState.loading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="h-9 w-full animate-pulse rounded-xl bg-slate-100"
                />
              ))}
            </div>
          ) : rowsState.error ? (
            <div className="p-4 border border-red-200 rounded-2xl bg-red-50 text-red-700 text-sm">
              {rowsState.error}
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="p-4 border border-slate-200 rounded-2xl bg-slate-50 text-slate-600 text-sm">
              Aucun créneau ne correspond aux filtres sélectionnés.
            </div>
          ) : (
            <div className="overflow-auto rounded-xl border border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-100/90 text-slate-700">
                  <tr>
                    <th className="px-3 py-2 text-left">Date</th>
                    <th className="px-3 py-2 text-left">Créneau</th>
                    <th className="px-3 py-2 text-left">Classe</th>
                    <th className="px-3 py-2 text-left">Discipline</th>
                    <th className="px-3 py-2 text-left">Enseignant</th>
                    <th className="px-3 py-2 text-left">Statut</th>
                    <th className="px-3 py-2 text-left">Détails</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredRows.map((r) => {
                    const statusColor =
                      r.status === "missing"
                        ? "border-l-4 border-red-400 bg-red-50/40 hover:bg-red-50"
                        : r.status === "late"
                        ? "border-l-4 border-amber-400 bg-amber-50/30 hover:bg-amber-50"
                        : "border-l-4 border-emerald-400 bg-white hover:bg-emerald-50/60";

                    return (
                      <tr
                        key={r.id}
                        className={`transition-colors ${statusColor}`}
                      >
                        <td className="px-3 py-2 text-slate-800 whitespace-nowrap">
                          {dateHumanFR(r.date)}
                        </td>
                        <td className="px-3 py-2 text-slate-700 whitespace-nowrap">
                          {r.period_label
                            ? r.period_label
                            : r.planned_start && r.planned_end
                            ? `${r.planned_start} – ${r.planned_end}`
                            : "—"}
                        </td>
                        <td className="px-3 py-2 text-slate-700 whitespace-nowrap">
                          {r.class_label || "—"}
                        </td>
                        <td className="px-3 py-2 text-slate-700 whitespace-nowrap">
                          {r.subject_name || "Discipline non renseignée"}
                        </td>
                        <td className="px-3 py-2 text-slate-700 whitespace-nowrap">
                          {r.teacher_name}
                        </td>
                        <td className="px-3 py-2 text-slate-700 whitespace-nowrap">
                          {statusBadge(r)}
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-600">
                          {r.status === "missing" && (
                            <span>
                              Aucun appel détecté pour ce créneau.{" "}
                              {originEmoji(r.opened_from)}{" "}
                            </span>
                          )}
                          {r.status === "late" && (
                            <span>
                              Appel réalisé avec retard.{" "}
                              {originEmoji(r.opened_from)}{" "}
                              {typeof r.late_minutes === "number"
                                ? `Retard estimé : ${r.late_minutes} min.`
                                : ""}
                            </span>
                          )}
                          {r.status === "ok" && (
                            <span>
                              Appel dans les délais. {originEmoji(r.opened_from)}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <p className="mt-3 text-[11px] text-slate-500">
            Cette vue repose sur trois éléments :{" "}
            <strong>emplois du temps importés</strong>,{" "}
            <strong>séances (teacher_sessions)</strong> et{" "}
            <strong>heure réelle d’appel (actual_call_at)</strong>. La route
            back-end utilisée est{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-[10px]">
              /api/admin/attendance/monitor
            </code>
            .
          </p>
        </section>
      </div>
    </main>
  );
}

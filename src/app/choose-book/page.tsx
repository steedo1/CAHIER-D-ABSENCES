"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Notebook,
  NotebookPen,
  ChevronRight,
  PenTool,
  FileText, // ✅ NOUVEAU
} from "lucide-react";

type SigEligibility = "checking" | "eligible" | "ineligible";

function getCookie(name: string) {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
  return m ? decodeURIComponent(m[2]) : null;
}

export default function ChooseBookPage() {
  const router = useRouter();

  const [isOnline, setIsOnline] = useState(true);
  const [sigEligibility, setSigEligibility] = useState<SigEligibility>("checking");
  const [sigHint, setSigHint] = useState<string | null>(null);

  useEffect(() => {
    const update = () =>
      setIsOnline(typeof navigator !== "undefined" ? navigator.onLine : true);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/teacher/signature", {
          cache: "no-store",
          credentials: "include",
        });

        if (cancelled) return;

        if (res.ok) {
          const json = await res.json().catch(() => null);
          setSigEligibility(json?.ok ? "eligible" : "ineligible");
          setSigHint(null);
        } else {
          setSigEligibility("ineligible");
          setSigHint(null);
        }
      } catch {
        if (cancelled) return;
        setSigEligibility("ineligible");
        if (typeof navigator !== "undefined" && !navigator.onLine) {
          setSigHint(
            "Hors ligne : vérification indisponible (reconnectez-vous une fois pour activer la vérification)."
          );
        } else {
          setSigHint(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  function resolveOfflineDest(book: "attendance" | "grades") {
    const byBook = getCookie(`mc_last_dest_${book}`);
    const generic = getCookie("mc_last_dest");
    const cookieDest = byBook || generic;
    const fallback = book === "grades" ? "/grades/class-device" : "/class";

    if (!cookieDest) return fallback;
    if (cookieDest.startsWith("http")) return fallback;
    return cookieDest.startsWith("/") ? cookieDest : fallback;
  }

  function handleBookClick(book: "attendance" | "grades") {
    return (e: React.MouseEvent) => {
      if (typeof navigator !== "undefined" && navigator.onLine) return;
      e.preventDefault();
      router.push(resolveOfflineDest(book));
    };
  }

  function handleReturnClick(e: React.MouseEvent) {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      e.preventDefault();
      router.back();
    }
  }

  const SignatureCardEligible = (
    <Link
      href="/enseignant/signature"
      className="group block rounded-3xl border border-emerald-200 bg-white p-6 shadow-sm ring-1 ring-emerald-100 transition hover:shadow-md md:col-span-2"
    >
      <div className="flex items-start gap-4">
        <div className="grid h-12 w-12 place-items-center rounded-xl bg-emerald-600 text-white">
          <PenTool className="h-6 w-6" />
        </div>
        <div className="flex-1">
          <div className="text-xl font-semibold text-slate-900">
            Ma signature (bulletins)
          </div>
          <p className="mt-1 text-sm text-slate-700">
            Enregistrez votre signature une seule fois.
          </p>
        </div>
      </div>
    </Link>
  );

  const SignatureCardDisabled = (
    <div className="rounded-3xl border bg-slate-50 p-6">
      <div className="text-sm text-slate-500">Indisponible</div>
    </div>
  );

  return (
    <main className="min-h-screen bg-white">
      {/* ✅ HEADER PREMIUM */}
      <header className="w-full bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 py-6 text-white shadow-sm">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4">
          <div>
            <div className="text-sm uppercase text-white/70">
              Espace enseignant
            </div>
            <div className="text-lg font-bold">
              Choisir votre cahier
            </div>
          </div>

          <Link
            href="/redirect"
            onClick={handleReturnClick}
            className="rounded-full bg-white/10 px-4 py-2 text-sm"
          >
            Retour
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-4 py-10">
        <div className="grid gap-5 md:grid-cols-2">

          {/* ABSENCES */}
          <Link
            href="/redirect?book=attendance"
            onClick={handleBookClick("attendance")}
            className="rounded-3xl border p-6 hover:shadow-md"
          >
            <Notebook className="h-6 w-6 text-indigo-600" />
            <div className="mt-3 font-semibold">
              Cahier des absences
            </div>
          </Link>

          {/* NOTES */}
          <Link
            href="/redirect?book=grades"
            onClick={handleBookClick("grades")}
            className="rounded-3xl border p-6 hover:shadow-md"
          >
            <NotebookPen className="h-6 w-6 text-violet-600" />
            <div className="mt-3 font-semibold">
              Cahier de notes
            </div>
          </Link>

          {/* ✅ NOUVELLE CARTE */}
          <Link
            href="/enseignant/autorisation-absence"
            className="rounded-3xl border border-amber-200 bg-white p-6 shadow-sm hover:shadow-md"
          >
            <FileText className="h-6 w-6 text-amber-600" />
            <div className="mt-3 font-semibold text-slate-900">
              Autorisation d’absence
            </div>
            <p className="text-sm text-slate-600 mt-1">
              Déclarez une absence sur une ou plusieurs journées et envoyez votre demande à l’administration.
            </p>
          </Link>

          {/* SIGNATURE */}
          {sigEligibility === "eligible"
            ? SignatureCardEligible
            : SignatureCardDisabled}

        </div>
      </section>
    </main>
  );
}
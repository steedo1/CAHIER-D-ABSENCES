//src/app/v/[code]/page.tsx
import { headers } from "next/headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Next 15 : headers() est async → il faut await.
 */
async function getOriginFromHeaders() {
  const h = await headers(); // Promise<ReadonlyHeaders>
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return "";
  return `${proto}://${host}`;
}

/**
 * Next 15 : PageProps attend params: Promise<...>
 */
type PageProps = {
  params: Promise<{ code: string }>;
};

export default async function VerifyByCodePage(props: PageProps) {
  // On récupère le vrai params en await
  const { code } = await props.params;
  const trimmedCode = (code || "").trim();

  const origin = await getOriginFromHeaders();

  // Si jamais origin est vide (cas très exotique), on prend NEXT_PUBLIC_APP_URL
  const base = origin || process.env.NEXT_PUBLIC_APP_URL || "";
  const search = new URLSearchParams({ c: trimmedCode });
  const url = `${base}/api/public/bulletins/verify?${search.toString()}`;

  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => null as any);

  const ok = res.ok && data?.ok;

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-xl rounded-2xl bg-white p-6 shadow">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-extrabold text-slate-900">
            Vérification du bulletin
          </h1>
          <span
            className={
              "rounded-full px-3 py-1 text-sm font-semibold " +
              (ok ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800")
            }
          >
            {ok ? "VALIDE" : "INVALIDE"}
          </span>
        </div>

        {!ok ? (
          <p className="mt-4 text-slate-700">
            Ce QR code est invalide, expiré ou a été révoqué.
          </p>
        ) : (
          <div className="mt-4 space-y-3 text-slate-800">
            {/* Établissement */}
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="text-sm text-slate-500">Établissement</div>
              <div className="font-semibold">
                {data?.institution?.name ?? "—"}
              </div>
              {data?.institution?.code ? (
                <div className="text-sm text-slate-600">
                  Code&nbsp;: {data.institution.code}
                </div>
              ) : null}
            </div>

            {/* Élève */}
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="text-sm text-slate-500">Élève</div>
              <div className="font-semibold">
                {data?.student?.full_name ?? "—"}
              </div>
              {data?.student?.matricule ? (
                <div className="text-sm text-slate-600">
                  Matricule&nbsp;: {data.student.matricule}
                </div>
              ) : null}
            </div>

            {/* Classe */}
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="text-sm text-slate-500">Classe</div>
              <div className="font-semibold">
                {data?.class?.label ?? data?.class?.name ?? "—"}
              </div>
              {data?.class?.academic_year ? (
                <div className="text-sm text-slate-600">
                  Année&nbsp;: {data.class.academic_year}
                </div>
              ) : null}
            </div>

            <p className="text-xs text-slate-500">
              Cette page confirme uniquement l’authenticité du bulletin (anti-fraude).
            </p>
          </div>
        )}
      </div>
    </main>
  );
}


//src/app/v/[code]/page.tsx
import { headers } from "next/headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function VerifyByCodePage({
  params,
}: {
  params: { code: string };
}) {
  const code = (params.code || "").trim();

  // ✅ Récupération de l'origine depuis les headers (host + proto)
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const fallbackOrigin = process.env.NEXT_PUBLIC_APP_URL || "";

  const origin = host ? `${proto}://${host}` : fallbackOrigin;

  const res = await fetch(
    `${origin}/api/public/bulletins/verify?c=${encodeURIComponent(code)}`,
    { cache: "no-store" }
  );

  const data = await res.json().catch(() => null);
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
              (ok
                ? "bg-emerald-100 text-emerald-800"
                : "bg-rose-100 text-rose-800")
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
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="text-sm text-slate-500">Établissement</div>
              <div className="font-semibold">
                {data?.institution?.name ?? "—"}
              </div>
              {data?.institution?.code ? (
                <div className="text-sm text-slate-600">
                  Code: {data.institution.code}
                </div>
              ) : null}
            </div>

            <div className="rounded-lg bg-slate-50 p-3">
              <div className="text-sm text-slate-500">Élève</div>
              <div className="font-semibold">
                {data?.student?.full_name ?? "—"}
              </div>
              {data?.student?.matricule ? (
                <div className="text-sm text-slate-600">
                  Matricule: {data.student.matricule}
                </div>
              ) : null}
            </div>

            <div className="rounded-lg bg-slate-50 p-3">
              <div className="text-sm text-slate-500">Classe</div>
              <div className="font-semibold">
                {data?.class?.label ?? data?.class?.name ?? "—"}
              </div>
              {data?.class?.academic_year ? (
                <div className="text-sm text-slate-600">
                  Année: {data.class.academic_year}
                </div>
              ) : null}
            </div>

            <p className="text-xs text-slate-500">
              Cette page confirme uniquement l’authenticité du bulletin
              (anti-fraude).
            </p>
          </div>
        )}
      </div>
    </main>
  );
}

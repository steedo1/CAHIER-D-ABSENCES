import { headers } from "next/headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function originFromHeaders() {
  const values = await headers();
  const host = values.get("x-forwarded-host") || values.get("host");
  const protocol = values.get("x-forwarded-proto") || (host?.includes("localhost") ? "http" : "https");
  if (host) return `${protocol}://${host}`;
  return process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "";
}

function formatDate(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "—";
  const date = new Date(raw);
  return Number.isNaN(date.getTime())
    ? raw
    : new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(date);
}

function formatValue(value: unknown, suffix = "") {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return `${number.toFixed(2).replace(".", ",")}${suffix}`;
}

export default async function VerifyDistinctionPage(props: any) {
  const params = await Promise.resolve(props?.params || {});
  const code = String(params?.code || "").trim().toLowerCase();
  const origin = await originFromHeaders();

  let data: any = null;
  try {
    const response = await fetch(
      new URL(`/api/public/distinctions/${encodeURIComponent(code)}`, origin).toString(),
      { cache: "no-store" },
    );
    data = await response.json().catch(() => null);
    if (!response.ok) data = null;
  } catch {
    data = null;
  }

  if (!data?.ok || !data?.valid) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-12 text-white">
        <div className="mx-auto max-w-xl rounded-[32px] border border-rose-400/30 bg-white/5 p-8 text-center shadow-2xl">
          <div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-rose-500/15 text-4xl">×</div>
          <h1 className="mt-6 text-3xl font-black">Distinction non vérifiée</h1>
          <p className="mt-3 text-slate-300">Ce code est invalide, inconnu ou le service de vérification n’est pas encore activé.</p>
          <div className="mt-6 rounded-2xl bg-black/20 px-4 py-3 font-mono text-sm text-slate-400">{code || "Aucun code"}</div>
        </div>
      </main>
    );
  }

  const summary = data.distinction?.summary || {};
  const metrics = [
    ["Moyenne générale", formatValue(summary.general_avg, " / 20")],
    ["Moyenne du palmarès", formatValue(summary.ranking_avg, " / 20")],
    ["Conduite", formatValue(summary.conduct_avg, " / 20")],
    ["Rang", summary.honour_rank ? `${summary.honour_rank}${summary.honour_rank === 1 ? "er" : "e"}` : null],
    ["Score professionnel", formatValue(summary.score, " / 100")],
    [String(summary.metric_label || "Critère"), summary.metric_value ? String(summary.metric_value) : null],
  ].filter((entry) => entry[1]);

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900 px-4 py-10 text-white">
      <div className="mx-auto max-w-2xl overflow-hidden rounded-[36px] border border-amber-300/30 bg-white text-slate-950 shadow-2xl">
        <div className="bg-gradient-to-r from-amber-500 to-amber-300 px-6 py-3 text-center text-xs font-black uppercase tracking-[0.25em] text-slate-950">
          Document authentique · Mon Cahier
        </div>
        <div className="p-7 sm:p-10">
          <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
            {data.institution?.logo_url ? (
              <img src={data.institution.logo_url} alt="Logo" className="h-24 w-24 object-contain" />
            ) : (
              <div className="grid h-24 w-24 place-items-center rounded-full bg-amber-100 text-4xl">✓</div>
            )}
            <div>
              <div className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Vérification réussie</div>
              <h1 className="mt-2 text-3xl font-black">{data.distinction?.title || "Distinction"}</h1>
              <p className="mt-1 font-bold text-slate-600">{data.institution?.name || "Établissement"}</p>
            </div>
          </div>

          <div className="mt-8 rounded-[28px] border border-amber-200 bg-amber-50 p-6 text-center">
            <div className="text-xs font-black uppercase tracking-[0.18em] text-amber-800">Bénéficiaire officiel</div>
            <div className="mt-2 text-3xl font-black text-slate-950">{data.recipient?.name}</div>
            {data.recipient?.class_label ? <div className="mt-2 font-bold text-slate-600">Classe de {data.recipient.class_label}</div> : null}
          </div>

          {metrics.length > 0 ? (
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {metrics.map(([label, value]) => (
                <div key={String(label)} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">{label}</div>
                  <div className="mt-1 text-lg font-black text-slate-950">{value}</div>
                </div>
              ))}
            </div>
          ) : null}

          <div className="mt-7 grid gap-3 rounded-2xl border border-slate-200 p-5 text-sm sm:grid-cols-2">
            <div><span className="font-black">Année scolaire :</span> {data.publication?.academic_year || "—"}</div>
            <div><span className="font-black">Période :</span> {data.publication?.period_code || "—"}</div>
            <div><span className="font-black">Émis le :</span> {formatDate(data.publication?.created_at)}</div>
            <div><span className="font-black">Code :</span> <span className="font-mono text-xs">{data.code}</span></div>
          </div>

          <p className="mt-6 text-center text-xs leading-relaxed text-slate-500">Cette page confirme qu’une distinction correspondant exactement à ce bénéficiaire a été enregistrée par l’établissement dans Mon Cahier.</p>
        </div>
      </div>
    </main>
  );
}

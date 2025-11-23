// src/app/api/teacher/grades/exports/route.ts
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function asCSV(rows: Record<string, any>[]) {
  const headers = [
    "student_id",
    "average",
    "average_rounded",
    "bonus",
    "count_evals",
    "total_evals",
    "rank",
  ];
  if (!rows.length) return headers.join(",") + "\n";

  const esc = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

  const lines = [headers.join(",")];
  for (const r of rows) lines.push(headers.map((h) => esc(r[h])).join(","));
  return lines.join("\n") + "\n";
}

/**
 * GET /api/teacher/grades/exports?class_id=...&subject_id=...&...
 * Proxy vers /api/teacher/grades/averages avec les mêmes params,
 * sérialise le JSON => CSV (disposition 'attachment').
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const averagesUrl = `${url.origin}/api/teacher/grades/averages${url.search}`;

  const res = await fetch(averagesUrl, {
    headers: { cookie: req.headers.get("cookie") ?? "" }, // forward cookies (RLS)
    cache: "no-store",
  });

  if (!res.ok) {
    const txt = await res.text();
    return new NextResponse(txt, {
      status: res.status,
      headers: {
        "content-type": res.headers.get("content-type") || "application/json",
      },
    });
  }

  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    items?: Array<Record<string, any>>;
  };

  if (!json?.ok) {
    return NextResponse.json(json ?? { ok: false, error: "AVERAGES_ERROR" }, { status: 400 });
  }

  const rows = Array.isArray(json.items) ? json.items : [];
  const csv = asCSV(rows);

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="export_moyennes_${Date.now()}.csv"`,
      "cache-control": "no-store",
    },
  });
}

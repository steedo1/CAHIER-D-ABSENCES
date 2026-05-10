// src/app/api/drenaet/reports/route.ts
import { NextRequest, NextResponse } from "next/server";
import { dayRangeFromSearchParams, guardDrenaetScope } from "../_helpers/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const g = await guardDrenaetScope();
  if ("error" in g) return g.error;

  if (!g.canExport && !g.isSuper) {
    return NextResponse.json({ error: "forbidden_export" }, { status: 403 });
  }

  const range = dayRangeFromSearchParams(new URL(req.url).searchParams);

  return NextResponse.json({
    ok: true,
    range,
    scope: {
      role: g.role,
      regional_directions: g.regionalDirections,
      institutions: g.institutions.length,
    },
    reports: [
      {
        key: "regional_daily",
        title: "Rapport journalier régional",
        description: "Synthèse des appels, absences, retards et séances confirmées sur la journée.",
        formats: ["csv", "pdf_later"],
      },
      {
        key: "attendance_weekly",
        title: "Rapport hebdomadaire d’assiduité",
        description: "Classement des établissements par absences et retards sur la période choisie.",
        formats: ["csv", "pdf_later"],
      },
      {
        key: "teacher_presence",
        title: "Rapport présence enseignants",
        description: "Taux de séances confirmées, séances non confirmées et établissements à surveiller.",
        formats: ["csv", "pdf_later"],
      },
      {
        key: "silent_institutions",
        title: "Établissements silencieux",
        description: "Établissements sans données d’appel ou de séance sur la période.",
        formats: ["csv", "pdf_later"],
      },
    ],
  });
}

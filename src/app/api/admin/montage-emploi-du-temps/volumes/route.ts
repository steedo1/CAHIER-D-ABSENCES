import { NextResponse } from "next/server";
import {
  defaultLevels,
  defaultSubjectHours,
  defaultSubjects,
} from "@/modules/montage-emploi-du-temps/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    source: "horaclasse_default_catalog",
    levels: defaultLevels,
    subjects: defaultSubjects,
    subjectHours: defaultSubjectHours,
    totals: {
      levels: defaultLevels.length,
      subjects: defaultSubjects.length,
      subjectHours: defaultSubjectHours.length,
    },
    message:
      "Référentiel HoraClasse chargé : volumes horaires et découpages prédéfinis par défaut.",
  });
}

import { NextResponse } from "next/server";
import {
  getCommunicationChannelState,
  getCommunicationClasses,
  getCommunicationInstitution,
  requireCommunicationAdmin,
} from "../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await requireCommunicationAdmin();
    if ("error" in ctx) return ctx.error;

    const [channels, classes, institution] = await Promise.all([
      getCommunicationChannelState(ctx.srv, ctx.institutionId),
      getCommunicationClasses(ctx.srv, ctx.institutionId, ctx.academicYear),
      getCommunicationInstitution(ctx.srv, ctx.institutionId),
    ]);

    const levels = Array.from(new Set(classes.map((cls) => cls.level).filter(Boolean)));

    return NextResponse.json({
      ok: true,
      institution_id: ctx.institutionId,
      institution_name: institution.display_name,
      academic_year: ctx.academicYear,
      channels,
      classes,
      levels,
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "Erreur chargement communication." },
      { status: 500 }
    );
  }
}

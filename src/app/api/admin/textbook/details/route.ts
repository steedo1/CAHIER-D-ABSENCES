import { NextRequest, NextResponse } from "next/server";
import { cleanUuid, requireTextbookManager } from "@/lib/textbook/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Only fetch session content when the manager opens a card; never preload it
// on the dashboard. Bound both the selected assignments and the result count.
export async function GET(req: NextRequest) {
  const auth = await requireTextbookManager();
  if (!auth.ok) return auth.response;
  const { srv, institutionId } = auth.ctx;

  const raw = String(new URL(req.url).searchParams.get("assignment_ids") || "");
  const input = raw.split(",").map((value) => value.trim()).filter(Boolean);
  const ids = Array.from(new Set(input.map((id) => cleanUuid(id))));
  if (!input.length || input.length > 20 || ids.length !== input.length || ids.some((id) => !id)) {
    return NextResponse.json({ ok: false, error: "invalid_assignment_ids" }, { status: 400 });
  }

  const { data: assignments, error: assignmentError } = await srv
    .from("textbook_progression_class_assignments")
    .select("id")
    .eq("institution_id", institutionId)
    .eq("is_active", true)
    .in("id", ids as string[]);

  if (assignmentError) {
    return NextResponse.json({ ok: false, error: assignmentError.message }, { status: 400 });
  }
  if ((assignments || []).length !== ids.length) {
    return NextResponse.json({ ok: false, error: "assignment_not_found" }, { status: 404 });
  }

  const { data: sessions, error: sessionError } = await srv
    .from("textbook_lesson_sessions")
    .select("id,assignment_id,session_title,session_date,duration_minutes,content,homework,observations")
    .eq("institution_id", institutionId)
    .in("assignment_id", ids as string[])
    .order("session_date", { ascending: false })
    .limit(40);

  if (sessionError) {
    return NextResponse.json({ ok: false, error: sessionError.message }, { status: 400 });
  }
  return NextResponse.json(
    { ok: true, sessions: sessions || [], limited: (sessions || []).length === 40 },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

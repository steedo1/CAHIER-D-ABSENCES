import { NextRequest } from "next/server";
import { GET as classSubjects } from "../../subjects/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Dedicated network-only URL, also compatible with older installed workers. */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  url.searchParams.set("offline_preparation", "v1");
  url.searchParams.set("all_slots", "1");
  return classSubjects(new NextRequest(url, { headers: request.headers }));
}

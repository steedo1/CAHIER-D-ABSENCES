import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const names = [
    "POSTGRES_URL",
    "POSTGRES_PRISMA_URL",
    "POSTGRES_URL_NON_POOLING",
    "DATABASE_URL",
    "SUPABASE_DB_URL",
  ] as const;

  const available = Object.fromEntries(
    names.map((name) => [name, Boolean(process.env[name]?.trim())]),
  );

  return NextResponse.json(
    {
      ok: true,
      available,
      anyDirectDatabaseUrl: Object.values(available).some(Boolean),
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}

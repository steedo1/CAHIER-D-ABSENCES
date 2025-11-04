// src/lib/push-dispatch.ts
export async function triggerDispatchInline(source = "inline") {
  const url =
    process.env.NEXT_PUBLIC_BASE_URL
      ? `${process.env.NEXT_PUBLIC_BASE_URL}/api/push/dispatch`
      : `/api/push/dispatch`; // Vercel: relative OK

  const secret = process.env.CRON_SECRET || process.env.CRON_PUSH_SECRET || "";

  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cron-secret": secret,
        "User-Agent": "mca-inline-dispatch",
      },
      body: JSON.stringify({ source }),
      cache: "no-store",
    });
  } catch (err) {
    console.warn("[inline-dispatch] fail", err);
  }
}

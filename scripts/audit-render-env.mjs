// Read-only preflight. Run in the target service environment. Never loads a
// credentials file, calls a network service, or prints values/fingerprints.
export const environmentContract = [
  ["NEXT_PUBLIC_SUPABASE_URL", "core"],
  ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "core"],
  ["SUPABASE_URL", "alias"],
  ["SUPABASE_SERVICE_ROLE_KEY", "core"],
  ["NEXT_PUBLIC_APP_URL", "origin"],
  ["NEXT_PUBLIC_BASE_URL", "origin"],
  ["NEXT_PUBLIC_SITE_URL", "origin"],
  ["CRON_SECRET", "cron"],
  ["PARENT_JWT_SECRET", "parents"],
  ["BULLETIN_QR_SECRET", "bulletin_qr"],
  ["VAPID_PUBLIC_KEY", "push"],
  ["VAPID_PRIVATE_KEY", "push"],
  ["NEXT_PUBLIC_VAPID_PUBLIC_KEY", "push_client"],
  ["ORANGE_CLIENT_ID", "sms"],
  ["ORANGE_CLIENT_SECRET", "sms"],
  ["ORANGE_SMS_SENDER", "sms"],
  ["ORANGE_OAUTH_URL", "default"],
  ["ORANGE_SMS_BASE_URL", "default"],
  ["SMS_WAIT_STATUS", "default"],
  ["SMS_MAX_ATTEMPTS", "default"],
  ["ATTENDANCE_LATE_THRESHOLD_MIN", "default"],
  ["ACADEMIC_YEAR_START_MONTH", "default"],
  ["DEFAULT_PHONE_PREFIX", "default"],
  ["NEXT_PUBLIC_DEFAULT_PHONE_PREFIX", "default"],
  ["DEFAULT_TEMP_PASSWORD", "accounts"],
  ["DEBUG_BULLETIN_QR", "diagnostic"],
  ["AI_GATEWAY_MODEL", "unused"],
];

export function auditEnvironment(env) {
  const present = key => typeof env[key] === "string" && env[key].trim().length > 0;
  const rows = environmentContract.map(([key, category]) => ({ key, category, present: present(key) }));
  const issues = rows.filter(row => !row.present && ["core", "cron", "parents", "bulletin_qr", "push", "sms", "accounts"].includes(row.category))
    .map(row => ({ key: row.key, code: "MISSING" }));
  for (const key of ["NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_BASE_URL", "NEXT_PUBLIC_SITE_URL"]) {
    if (!present(key)) { issues.push({ key, code: "MISSING_ORIGIN" }); continue; }
    try {
      const url = new URL(env[key]);
      if (url.protocol !== "https:" || !["www.mon-cahier.com", "mon-cahier.com"].includes(url.host) ||
          url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error();
    } catch { issues.push({ key, code: "INVALID_PRODUCTION_ORIGIN" }); }
  }
  if (present("VAPID_PUBLIC_KEY") && present("NEXT_PUBLIC_VAPID_PUBLIC_KEY") && env.VAPID_PUBLIC_KEY.trim() !== env.NEXT_PUBLIC_VAPID_PUBLIC_KEY.trim()) {
    issues.push({ key: "NEXT_PUBLIC_VAPID_PUBLIC_KEY", code: "PUBLIC_KEY_MISMATCH" });
  }
  return { ok: issues.length === 0, rows, issues };
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file://").href) {
  const result = auditEnvironment(process.env);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  process.exitCode = result.ok ? 0 : 1;
}

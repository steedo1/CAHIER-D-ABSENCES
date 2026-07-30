export const MON_CAHIER_WEB_RELEASE =
  process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
  process.env.NEXT_PUBLIC_MON_CAHIER_RELEASE ||
  "development";

export const MON_CAHIER_SERVICE_WORKER_RELEASE =
  "2026-07-30-class-device-lifecycle-v5-2";

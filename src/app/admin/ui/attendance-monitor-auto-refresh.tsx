"use client";

import { useEffect } from "react";

const MONITOR_PATH = "/admin/absences/appels";
const REFRESH_INTERVAL_MS = 10_000;

function clickRefreshButton() {
  if (typeof window === "undefined") return;
  if (window.location.pathname !== MONITOR_PATH) return;
  if (document.visibilityState !== "visible") return;
  if (typeof navigator !== "undefined" && !navigator.onLine) return;

  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("button"));
  const refreshButton = buttons.find((button) => {
    const label = (button.textContent || "").replace(/\s+/g, " ").trim();
    return label === "Actualiser" || label === "Actualisation...";
  });

  if (!refreshButton || refreshButton.disabled) return;
  refreshButton.click();
}

export default function AttendanceMonitorAutoRefresh() {
  useEffect(() => {
    const refresh = () => clickRefreshButton();
    const refreshSoon = () => window.setTimeout(refresh, 250);

    const intervalId = window.setInterval(refresh, REFRESH_INTERVAL_MS);

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refreshSoon();
    };

    window.addEventListener("online", refreshSoon);
    window.addEventListener("focus", refreshSoon);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("online", refreshSoon);
      window.removeEventListener("focus", refreshSoon);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return null;
}

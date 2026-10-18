"use client";

import { useEffect, useState } from "react";
import { useSchoolNavigation } from "@/components/admin/SchoolNavigationProvider";
import { parseSchoolCyclesSettings } from "@/lib/school-cycles";
import { isBilingualSchool } from "@/lib/school-student-programs";

type BilingualMode = {
  isBilingual: boolean;
  loading: boolean;
  error: string | null;
};

/** The File Correspondent has no SchoolNavigationProvider in AdminLayout.
 * Never default to historical calculations while the school type is unknown.
 */
export function useBilingualCorrespondentMode(): BilingualMode {
  const navigation = useSchoolNavigation();
  const serverSettings = navigation?.settings;
  const [resolved, setResolved] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (serverSettings) {
      setResolved(isBilingualSchool(serverSettings));
      setError(null);
      return;
    }
    const controller = new AbortController();
    fetch("/api/admin/institution/settings", {
      cache: "no-store", signal: controller.signal,
    }).then(async response => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.settings_json) {
        throw new Error(data.error || "Configuration de l’établissement indisponible.");
      }
      setResolved(isBilingualSchool(parseSchoolCyclesSettings(data.settings_json)));
      setError(null);
    }).catch(cause => {
      if (controller.signal.aborted) return;
      setResolved(null);
      setError(cause instanceof Error ? cause.message : "Configuration scolaire indisponible.");
    });
    return () => controller.abort();
  }, [serverSettings]);

  return { isBilingual: resolved === true, loading: !error && resolved === null, error };
}

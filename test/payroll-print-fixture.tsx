// Synthetic-only fixture: imports the real sheet without connecting to Supabase.
import React from "react";
import { createRoot } from "react-dom/client";
import PayrollPrintSheet from "../src/app/admin/finance/payroll/PayrollPrintSheet";

const params = new URLSearchParams(location.search);
let printCount = 0;
if (!params.has("native")) window.print = () => {
  printCount++;
  const status = document.createElement("p");
  status.textContent = `Test : impression déclenchée ${printCount} fois`;
  document.querySelector(".payroll-print-toolbar")?.appendChild(status);
};
const lines = Array.from({ length: params.has("long") ? 38 : 6 }, (_, i) => ({
  id: String(i), teacher_name_snapshot: `Enseignant de démonstration ${i + 1}`,
  actual_sessions: 12, expected_sessions: 14, gross_amount: 24000, lost_amount: 182, adjusted_amount: 23818,
}));
const logo = params.has("broken") ? "/missing-logo.png" : "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" rx="24" fill="#064e3b"/><text x="60" y="70" text-anchor="middle" font-family="sans-serif" font-size="30" fill="white">TEST</text></svg>');
createRoot(document.getElementById("root")!).render(<React.StrictMode>
  <PayrollPrintSheet autoPrint={params.has("auto")} institutionCfg={{ institution_name: "Collège de démonstration", institution_logo_url: params.has("nologo") ? null : logo, institution_head_name: "Direction de démonstration" }}
    selectedRun={{period_month:"2026-06",period_start:"2026-06-01",period_end:"2026-06-30",academic_year:"2025-2026",status:"draft"}}
    lines={lines} totals={{ actualSessions: lines.length * 12, gross: lines.length * 24000, retained: lines.length * 182, payable: lines.length * 23818 }}
    effectiveReferenceMinutes={55} effectiveLateTolerance={15} effectiveEarlyTolerance={5} />
</React.StrictMode>);

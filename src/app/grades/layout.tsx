import type { ReactNode } from "react";

export default function GradesLayout({ children }: { children: ReactNode }) {
  return (
    <div data-mc-grades-root>
      <style>{`
        [data-mc-grades-root] button:has(svg.lucide-file-spreadsheet) {
          display: none !important;
        }
      `}</style>
      {children}
    </div>
  );
}

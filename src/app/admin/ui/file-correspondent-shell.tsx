"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import {
  FILE_CORRESPONDENT_HOME,
  isFileCorrespondentPathAllowed,
} from "@/lib/auth/file-correspondent";
import AdminShell from "./shell";

export default function FileCorrespondentShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const allowed = isFileCorrespondentPathAllowed(pathname);

  useEffect(() => {
    if (!pathname || allowed) return;
    router.replace(FILE_CORRESPONDENT_HOME);
  }, [allowed, pathname, router]);

  if (!allowed) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-50 px-4">
        <div className="rounded-2xl border bg-white px-6 py-5 text-sm font-semibold text-slate-700 shadow-sm">
          Redirection vers l’espace Correspondant fichier…
        </div>
      </div>
    );
  }

  return <AdminShell initialRole="file_correspondent">{children}</AdminShell>;
}

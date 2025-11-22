// src/app/admin/ui/shell.tsx
import Link from "next/link"; // ✅ ajout
import { LogoutButton } from "@/components/LogoutButton";
import SidebarNav from "./sidebar-nav";
import ContactUsButton from "@/components/ContactUsButton"; //  & import

export default function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="grid md:grid-cols-[250px_1fr]">
        <aside className="hidden md:block sticky top-0 h-screen bg-slate-900">
          <div className="h-full overflow-y-auto scrollbar-thin scrollbar-track-slate-900 scrollbar-thumb-slate-700/70">
            <SidebarNav />
          </div>
        </aside>

        <div className="min-h-screen">
          {/* HEADER BLEU NUIT */}
          <header className="sticky top-0 z-40 bg-blue-950 text-white border-b border-blue-900/60 ring-1 ring-blue-800/40">
            <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium tracking-tight">Mon Cahier</span>
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs font-semibold ring-1 ring-white/20">
                  Absences &amp; notes · Admin établissement
                </span>
              </div>
              <div className="flex items-center gap-2">
                {/* ✅ Accès direct Conduite */}
                <Link
                  href="/admin/conduite"
                  className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold ring-1 ring-white/20 hover:bg-white/15"
                >
                  Conduite
                </Link>
                <ContactUsButton variant="chip" /> {/*  & le bouton */}
                <div className="rounded-full bg-white/10 px-2 py-1 ring-1 ring-white/20 hover:bg-white/15">
                  <LogoutButton />
                </div>
              </div>
            </div>
          </header>

          <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
        </div>
      </div>
    </div>
  );
}

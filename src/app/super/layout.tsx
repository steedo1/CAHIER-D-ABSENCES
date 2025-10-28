// src/app/super/layout.tsx
import type { Metadata } from "next";
import Shell from "./ui/Shell";

export const metadata: Metadata = {
  title: "Mon Cahier d'Absences - Super Admin",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function SuperLayout({ children }: { children: React.ReactNode }) {
  return <Shell>{children}</Shell>;
}

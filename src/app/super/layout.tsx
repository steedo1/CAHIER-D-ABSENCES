// src/app/super/layout.tsx
import type { Metadata } from "next";
import Shell from "./ui/Shell"; // �S& bon chemin

export const metadata: Metadata = {
  title: "Mon Cahier d�"Absences � Super Admin",
};

export default function SuperLayout({ children }: { children: React.ReactNode }) {
  return <Shell>{children}</Shell>;
}



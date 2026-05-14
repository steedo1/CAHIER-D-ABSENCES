// src/app/founder/layout.tsx
import type { Metadata } from "next";
import type { ReactNode } from "react";
import FounderShell from "./ui/Shell";

export const metadata: Metadata = {
  title: "Mon Cahier — Espace Fondateur",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function FounderLayout({ children }: { children: ReactNode }) {
  return <FounderShell>{children}</FounderShell>;
}

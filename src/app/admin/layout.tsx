import type { Metadata } from "next";
import AdminShell from "./ui/shell"; // �a� casse correcte

export const metadata: Metadata = { title: "Espace �0tablissement  Admin" };
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}



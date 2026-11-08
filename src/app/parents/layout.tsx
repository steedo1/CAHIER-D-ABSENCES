import type { ReactNode } from "react";
import ParentInstallPrompt from "@/components/parent/ParentInstallPrompt";

export default function ParentsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <ParentInstallPrompt />
      {children}
    </>
  );
}

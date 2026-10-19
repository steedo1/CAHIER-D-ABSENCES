import type { ReactNode } from "react";
import ClassDeviceInstallButton from "@/components/ClassDeviceInstallButton";

export default function ClassDeviceGradesLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="mx-auto max-w-7xl px-4 pt-4">
        <ClassDeviceInstallButton />
      </div>
      {children}
    </>
  );
}

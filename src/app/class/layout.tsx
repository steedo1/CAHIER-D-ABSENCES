import type { ReactNode } from "react";
import ClassDeviceInstallButton from "@/components/ClassDeviceInstallButton";

export default function ClassLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="mx-auto max-w-5xl px-4 pt-4">
        <ClassDeviceInstallButton />
      </div>
      {children}
    </>
  );
}

import type { ReactNode } from "react";
import ClassDeviceSyncGuard from "./ClassDeviceSyncGuard";

export default function ClassLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <ClassDeviceSyncGuard />
      {children}
    </>
  );
}

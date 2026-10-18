import type { ReactNode } from "react";
import ClassicGradePublicationOnly from "@/components/admin/ClassicGradePublicationOnly";

export default function GradePublicationLegacyLayout({ children }: { children: ReactNode }) {
  return <ClassicGradePublicationOnly>{children}</ClassicGradePublicationOnly>;
}

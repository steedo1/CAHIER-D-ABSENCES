"use client";
import { useState } from "react";
import SchoolSubjectProgramsEditor from "@/components/admin/SchoolSubjectProgramsEditor";
import SchoolBulletinSettings from "@/components/admin/SchoolBulletinSettings";

export default function SchoolBulletinConfiguration() {
  const [version, setVersion] = useState(0);
  return <div className="space-y-6">
    <SchoolSubjectProgramsEditor onSaved={() => setVersion(current => current + 1)} />
    <SchoolBulletinSettings key={version}/>
  </div>;
}

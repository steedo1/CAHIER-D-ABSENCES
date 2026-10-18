import type { TeachingDocumentSignatory } from "@/lib/franco-arabic-document-signatories";
import { SCHOOL_TEACHING_DIRECTOR_TITLE } from "@/lib/school-teaching-signatories";

/** Names are escaped by React. These are signature labels, never signature images. */
export default function DocumentDirectionSignatures({ signatories, className = "", inline = false }: {
  signatories: TeachingDocumentSignatory[] | null | undefined;
  className?: string;
  inline?: boolean;
}) {
  if (signatories == null) return null;
  const rows = signatories.length ? signatories : [{ title: SCHOOL_TEACHING_DIRECTOR_TITLE, name: "Nom du directeur non renseigné" }];
  if (inline) return <span data-document-directions className={className}>
    {rows.map((row, index) => <span key={"track" in row ? row.track : index}>
      <strong>{row.title} :</strong>{" "}{row.name}
    </span>)}
  </span>;
  return <div data-document-directions className={className}
    style={{ display: "flex", justifyContent: "flex-end", gap: 24, breakInside: "avoid", fontSize: 11 }}>
    {rows.map((row, index) => <div key={"track" in row ? row.track : index} style={{ textAlign: "center" }}>
      <strong>{row.title}</strong>
      <div style={{ marginTop: 8 }}>{row.name}</div>
    </div>)}
  </div>;
}

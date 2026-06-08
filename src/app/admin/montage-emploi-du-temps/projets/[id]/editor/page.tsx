import MontageDraftEditor from "@/modules/montage-emploi-du-temps/components/MontageDraftEditor";

export const dynamic = "force-dynamic";

export default async function MontageDraftEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <MontageDraftEditor projectId={id} />;
}

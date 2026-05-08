import MontageProjectPreview from "@/modules/montage-emploi-du-temps/components/MontageProjectPreview";

export const dynamic = "force-dynamic";

export default function MontageProjectPreviewPage({
  params,
}: {
  params: { id: string };
}) {
  return <MontageProjectPreview projectId={params.id} />;
}
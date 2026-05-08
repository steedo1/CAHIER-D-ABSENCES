import MontageProjectPreview from "@/modules/montage-emploi-du-temps/components/MontageProjectPreview";

export const dynamic = "force-dynamic";

export default async function MontageProjectPreviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <MontageProjectPreview projectId={id} />;
}
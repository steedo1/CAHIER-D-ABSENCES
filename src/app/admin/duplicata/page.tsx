import { redirect } from "next/navigation";
import { getOfficialDocumentAccess } from "@/lib/official-documents";
import { getFinanceAccessForCurrentUser } from "@/lib/finance-access";

export const dynamic = "force-dynamic";

export default async function DuplicataHomePage() {
  const access = await getOfficialDocumentAccess();
  if (!access.userId) redirect("/login");
  if (!access.ok || !access.institutionId) redirect("/admin");

  if (access.canReadReceipts) {
    const financeAccess = await getFinanceAccessForCurrentUser("full").catch(
      () => null,
    );
    if (
      financeAccess?.ok &&
      financeAccess.institutionId === access.institutionId
    ) {
      redirect("/admin/duplicata/recus");
    }
  }

  if (access.canReadBulletins) {
    redirect("/admin/duplicata/bulletins");
  }

  redirect("/admin");
}

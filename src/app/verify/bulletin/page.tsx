// src/app/verify/bulletin/page.tsx
import { Suspense } from "react";
import VerifyBulletinClient from "./VerifyBulletinClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function Page() {
  return (
    <main className="min-h-screen">
      <Suspense fallback={<div className="p-6 text-sm">Chargement…</div>}>
        <VerifyBulletinClient />
      </Suspense>
    </main>
  );
}

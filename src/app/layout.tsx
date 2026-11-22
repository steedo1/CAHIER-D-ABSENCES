// web/src/app/layout.tsx
import type { Metadata, Viewport } from "next";
import Providers from "./providers";
import "./globals.css";
import "./class-list-print-tuning.css";
import ServiceWorkerRegistrar from "@/components/ServiceWorkerRegistrar";
import OfflineAccessGuard from "@/components/OfflineAccessGuard";
import BackgroundAttendancePreparation from "@/components/BackgroundAttendancePreparation";
import BackgroundAttendanceDeliverySync from "@/components/BackgroundAttendanceDeliverySync";
import RelayCapabilityProvider from "@/components/RelayCapabilityProvider";
import ClassListPrintEnhancer from "@/components/ClassListPrintEnhancer";
import ClassListCorrectionsPanel from "@/components/ClassListCorrectionsPanel";

export const metadata: Metadata = {
  applicationName: "Mon Cahier",
  title: "Mon Cahier",
  description:
    "Suivi scolaire, appels de présence et continuité hors ligne pour les établissements.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.v2.png", type: "image/png", sizes: "64x64" },
      { url: "/icons/icon-192.v2.png", type: "image/png", sizes: "192x192" },
    ],
    shortcut: "/favicon.v2.png",
    apple: [{ url: "/icons/icon-192.v2.png", sizes: "192x192" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#059669",
  colorScheme: "light",
};

// Exécuté avant l'hydratation : les liens de récupération du dashboard Supabase
// reviennent parfois sur la racine (Site URL), avec des jetons dans le fragment.
const recoveryEntryScript = "(function () {\n  try {\n    var hash = new URLSearchParams(window.location.hash.slice(1));\n    var query = new URLSearchParams(window.location.search);\n    var recovery = (hash.get(\"type\") === \"recovery\" && hash.has(\"access_token\") && hash.has(\"refresh_token\")) ||\n      (query.get(\"type\") === \"recovery\" && query.has(\"token_hash\")) ||\n      (window.location.pathname === \"/reset-password\" && query.has(\"code\"));\n    var failed = query.get(\"error_code\") === \"otp_expired\" ||\n      (query.get(\"error\") === \"access_denied\" && query.has(\"error_description\"));\n    if (recovery) {\n      sessionStorage.setItem(\"mca-password-recovery-started\", String(Date.now()));\n    }\n    if (window.location.pathname === \"/\" && (recovery || failed)) {\n      window.location.replace(\"/reset-password\" + window.location.search + window.location.hash);\n    }\n  } catch (_) { /* Le routage habituel reste disponible. */ }\n})();";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <body>
        <script dangerouslySetInnerHTML={{ __html: recoveryEntryScript }} />
        <Providers>
          <RelayCapabilityProvider>
            <OfflineAccessGuard>{children}</OfflineAccessGuard>
            <BackgroundAttendancePreparation />
            <BackgroundAttendanceDeliverySync />
          </RelayCapabilityProvider>
        </Providers>
        <ServiceWorkerRegistrar />
        <ClassListPrintEnhancer />
        <ClassListCorrectionsPanel />
      </body>
    </html>
  );
}

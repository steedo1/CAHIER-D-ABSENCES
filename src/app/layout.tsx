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
      { url: "/favicon.png", type: "image/png", sizes: "1024x1024" },
      { url: "/icons/icon-192.png", type: "image/png", sizes: "192x192" },
    ],
    shortcut: "/favicon.png",
    apple: [{ url: "/icons/icon-192.png", sizes: "192x192" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#059669",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <body>
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

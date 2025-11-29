// web/app/layout.tsx
import type { Metadata } from "next";
import Providers from "./providers";
import "./globals.css";
import ServiceWorkerRegistrar from "@/components/ServiceWorkerRegistrar";

export const metadata: Metadata = {
  title: "Mon Cahier d’Absences",
  description: "Portail web - Admin & Enseignants",
  icons: {
    icon: "/favicon.png",       // 🔥 pris dans /public
    shortcut: "/favicon.png",
    apple: "/favicon.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <head>
        {/* On force le favicon au cas où */}
        <link rel="icon" href="/favicon.png" sizes="32x32" />
      </head>
      <body>
        <Providers>{children}</Providers>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}

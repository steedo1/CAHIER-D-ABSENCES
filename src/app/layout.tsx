// web/src/app/layout.tsx
import type { Metadata } from "next";
import Providers from "./providers";
import "./globals.css";
import ServiceWorkerRegistrar from "@/components/ServiceWorkerRegistrar";

export const metadata: Metadata = {
  title: "Mon Cahier d’Absences",
  description: "Portail web - Admin & Enseignants",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },   // si tu as mis le .ico
      { url: "/favicon.png", type: "image/png" },
    ],
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
      <body>
        <Providers>{children}</Providers>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}

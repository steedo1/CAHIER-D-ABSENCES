// web/app/layout.tsx
import type { Metadata, Viewport } from "next";
import Providers from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Mon Cahier d’Absences",
    template: "%s · Mon Cahier d’Absences",
  },
  description: "Portail web — Admin & Enseignants",
  applicationName: "Mon Cahier d’Absences",
  keywords: [
    "absences",
    "retards",
    "école",
    "parents",
    "enseignants",
    "tableau de bord",
  ],
  authors: [{ name: "Mon Cahier d’Absences" }],
  alternates: { canonical: "/" },
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
  themeColor: "#0b1b4f",
  metadataBase:
    typeof process !== "undefined" && process.env.NEXT_PUBLIC_SITE_URL
      ? new URL(process.env.NEXT_PUBLIC_SITE_URL)
      : new URL("http://localhost:3000"),
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b1b4f",
  colorScheme: "light",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" dir="ltr" suppressHydrationWarning>
      <head>
        {/* Encodage explicite pour éviter tout mojibake */}
        <meta charSet="utf-8" />
        <meta httpEquiv="content-language" content="fr" />
        <meta name="format-detection" content="telephone=no" />
      </head>
      <body className="antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

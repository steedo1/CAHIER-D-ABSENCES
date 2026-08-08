import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Mon Cahier d’Absences",
    short_name: "Mon Cahier",
    description:
      "Cahier numérique d’absences, d’appels et de suivi scolaire, utilisable hors connexion.",
    start_url: "/login",
    scope: "/",
    display: "standalone",
    background_color: "#f8fafc",
    theme_color: "#047857",
    lang: "fr",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/favicon.png",
        sizes: "1024x1024",
        type: "image/png",
      },
    ],
  };
}

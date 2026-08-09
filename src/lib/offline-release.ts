/**
 * Version du code Web. Elle change à chaque déploiement et ne doit jamais
 * invalider les données métier déjà préparées sur l'appareil.
 */
export const MON_CAHIER_WEB_RELEASE =
  process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
  process.env.NEXT_PUBLIC_MON_CAHIER_RELEASE ||
  "development";

/**
 * Version du format des données hors ligne. Elle ne change que lorsqu'une
 * migration réellement incompatible du planning, des élèves ou des opérations
 * d'appel est introduite.
 */
export const MON_CAHIER_OFFLINE_SCHEMA_VERSION = 1;

/**
 * Version du code du service worker, utile pour le diagnostic et les mises à
 * jour. Une différence de release reste non bloquante si le schéma hors ligne
 * est compatible et que le shell déjà préparé est disponible.
 */
export const MON_CAHIER_SERVICE_WORKER_RELEASE =
  "2026-08-09-pwa-stable-v5-5";

/**
 * Version du format des caches PWA. Les noms de cache restent stables entre les
 * déploiements ordinaires afin de ne pas supprimer les écrans déjà préparés.
 */
export const MON_CAHIER_SERVICE_WORKER_CACHE_VERSION = "v2";

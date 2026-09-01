export const FILE_CORRESPONDENT_HOME = "/admin/dashboard";

// Navigation du profil uniquement : les contrôles serveur des API restent
// indépendants. Le tableau de bord s'ajoute aux rubriques déjà autorisées.
const EXACT_PATHS = new Set([
  FILE_CORRESPONDENT_HOME,
  "/admin/export-moyennes",
  "/admin/notes/conseil-classe",
  "/admin/notes/bilan",
  "/admin/notes/matrices",
  "/admin/notes/matrice-annuelle",
  "/admin/notes/non-classes",
  "/admin/parametres",
]);

const PATH_PREFIXES = [
  "/admin/finance/statistiques-generales",
  "/admin/bulletins",
  "/admin/organisation-pedagogique",
  "/admin/classes",
  "/admin/affectations",
  "/admin/parents",
  "/admin/import",
  "/admin/import-emplois-du-temps",
  "/admin/notes/predictions",
];

export function isFileCorrespondentPathAllowed(href: string | null): boolean {
  if (!href) return false;
  const pathname = href.split(/[?#]/, 1)[0];
  return (
    EXACT_PATHS.has(pathname) ||
    PATH_PREFIXES.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    )
  );
}

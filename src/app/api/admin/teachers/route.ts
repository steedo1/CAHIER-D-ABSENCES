// src/app/api/admin/teachers/route.ts
//
// Endpoint historique conservé pour compatibilité. La source de vérité est la
// route sécurisée /api/admin/teachers/by-subject : même authentification,
// même périmètre établissement/groupe et même filtrage de discipline.
export { GET } from "./by-subject/route";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { routeForRole, routeForRoleWithBook, routeForUser } from "../src/lib/auth/routing.ts";
import { FILE_CORRESPONDENT_HOME, isFileCorrespondentPathAllowed } from "../src/lib/auth/file-correspondent.ts";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
const h = React.createElement;
let location = new URL("https://example.test/admin/dashboard");
let relayEnabled = false;
const Link = ({ href, children, prefetch: _prefetch, ...props }) => h("a", { ...props, href }, children);
const empty = () => null;
const mocks = {
  "next/link": { __esModule: true, default: Link },
  "next/navigation": {
    usePathname: () => location.pathname,
    useSearchParams: () => location.searchParams,
    useRouter: () => ({ replace() {} }),
  },
  "@/app/providers": { useAuth: () => ({ session: { user: { id: "test-user" } } }) },
  "@/components/RelayCapabilityProvider": { useRelayCapability: () => ({ relayEnabled }) },
  "@/components/LogoutButton": { LogoutButton: empty },
  "@/components/auth/TrueLogoutButton": { __esModule: true, default: empty },
  "@/components/ContactUsButton": { __esModule: true, default: empty },
  "@/components/admin/MonCahierAiChatBubble": { __esModule: true, default: empty },
  "@/lib/offline-auth-client": { OFFLINE_AUTH_STATE_EVENT: "test-offline", getOfflineAccessIntent: async () => null },
  "@/lib/offline-auth-contract": { OFFLINE_ADMIN_STATIC_PATHS: [], isOfflinePathAllowedForRole: () => false },
  "@/lib/offline": { warmOfflineShell: async () => {} },
  "@/lib/local-relay": {},
};

// Render the real TSX components with React. Only authentication, navigation and
// network boundaries are doubled: these tests never connect to the school DB.
const modules = new Map();
function load(file) {
  file = path.resolve(root, file);
  if (!path.extname(file)) file += fs.existsSync(`${file}.tsx`) ? ".tsx" : ".ts";
  if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} };
  modules.set(file, module);
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  new Function("require", "module", "exports", code)((id) => {
    if (id in mocks) return mocks[id];
    if (id.startsWith("@/")) return load(`src/${id.slice(2)}`);
    if (id.startsWith(".")) return load(path.resolve(path.dirname(file), id));
    return require(id);
  }, module, module.exports);
  return module.exports;
}

const Sidebar = load("src/app/admin/ui/sidebar-nav.tsx").default;
const RestrictedShell = load("src/app/admin/ui/file-correspondent-shell.tsx").default;
const Dashboard = load("src/app/admin/dashboard/client.tsx").default;
const { AdminRoleContext } = load("src/app/admin/ui/admin-role-context.tsx");
function sidebar(role, href = "/admin/dashboard", relay = false) {
  location = new URL(href, "https://example.test");
  relayEnabled = relay;
  return renderToStaticMarkup(h(Sidebar, { role }));
}
function links(html) {
  return [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1].replaceAll("&amp;", "&"));
}

test("le Correspondant arrive sur le dashboard admin pour les deux cahiers", () => {
  assert.equal(routeForRole("file_correspondent"), FILE_CORRESPONDENT_HOME);
  assert.equal(routeForRoleWithBook("file_correspondent", "attendance"), FILE_CORRESPONDENT_HOME);
  assert.equal(routeForRoleWithBook("file_correspondent", "grades"), FILE_CORRESPONDENT_HOME);
  assert.equal(routeForRole("admin"), "/admin/dashboard");
  assert.equal(routeForRoleWithBook("admin", "grades"), "/admin/notes");
  assert.equal(routeForRole("finance_manager"), "/admin/finance");
});

test("un admin cumulant le rôle Correspondant garde la priorité admin", async () => {
  const supabase = { from: () => ({ select: () => ({ eq: async () => ({
    data: [{ role: "file_correspondent" }, { role: "admin" }], error: null,
  }) }) }) };
  assert.equal(await routeForUser("test-user", supabase, "grades"), "/admin/notes");
});

test("le périmètre ajoute le dashboard sans ouvrir les autres fonctions admin", () => {
  for (const href of [FILE_CORRESPONDENT_HOME, "/admin/export-moyennes", "/admin/classes/liste/test?academic_year=2026-2027", "/admin/parametres?tab=school", "/admin/finance/statistiques-generales", "/admin/bulletins/test", "/admin/notes/conseil-classe"]) {
    assert.equal(isFileCorrespondentPathAllowed(href), true, href);
  }
  for (const href of [null, "/admin/users", "/admin/finance", "/admin/finance/payments", "/admin/finance/statistiques-generales-other", "/admin/dashboard/private", "/admin/classes-other", "/admin/notes", "/admin/absences", "/admin/relais", "/admin/statistiques", "/api/admin/users", "https://example.test/admin/dashboard"]) {
    assert.equal(isFileCorrespondentPathAllowed(href), false, href);
  }
});

test("le menu partagé affiche le dashboard et trois groupes repliés à l'accueil", () => {
  const html = sidebar("file_correspondent");
  assert.equal((html.match(/aria-expanded="false"/g) || []).length, 3);
  assert.equal((html.match(/aria-expanded="true"/g) || []).length, 0);
  assert.deepEqual(links(html), ["/admin/dashboard"]);
  for (const title of ["Correspondant fichier", "Organisation scolaire", "Paramètres"]) assert.ok(html.includes(title));
  for (const title of ["Gestion financière", "Utilisateurs &amp; rôles", "Administration &amp; services", "Infirmerie", "Cahier des absences", "Cahier de notes", "Duplicata"]) assert.ok(!html.includes(title), title);
});

test("une liste de classe ouvre uniquement Organisation scolaire et conserve ses sous-pages", () => {
  const html = sidebar("file_correspondent", "/admin/classes/liste/test");
  assert.equal((html.match(/aria-expanded="true"/g) || []).length, 1);
  assert.equal((html.match(/aria-expanded="false"/g) || []).length, 2);
  assert.ok(links(html).includes("/admin/parents"));
  assert.ok(!links(html).includes("/admin/users"));
  assert.ok(links(html).every(isFileCorrespondentPathAllowed));
});

test("les statistiques générales n'activent jamais le menu financier du Correspondant", () => {
  const html = sidebar("file_correspondent", "/admin/finance/statistiques-generales");
  assert.ok(links(html).includes("/admin/finance/statistiques-generales"));
  assert.ok(links(html).includes("/admin/export-moyennes"));
  assert.ok(!html.includes("Encaissements"));
  assert.ok(!html.includes("Paie des enseignants"));
  assert.ok(links(html).every(isFileCorrespondentPathAllowed));
});

test("les paramètres surlignent un seul onglet et ne donnent pas accès au Relais", () => {
  const html = sidebar("file_correspondent", "/admin/parametres?tab=school", true);
  assert.equal((html.match(/aria-current="page"/g) || []).length, 1);
  const activeLink = html.match(/<a\b[^>]*aria-current="page"[^>]*>/)?.[0];
  assert.ok(activeLink?.includes('href="/admin/parametres?tab=school"'));
  assert.ok(!links(html).includes("/admin/relais"));
  assert.ok(links(html).every(isFileCorrespondentPathAllowed));
});

test("le menu admin conserve ses groupes, la gestion utilisateurs et son accès Relais", () => {
  const html = sidebar("admin", "/admin/users");
  assert.ok((html.match(/aria-expanded=/g) || []).length > 3);
  assert.ok(links(html).includes("/admin/users"));
  assert.ok(html.includes("Cahier des absences"));
  assert.ok(links(sidebar("admin", "/admin/parametres?tab=school", true)).includes("/admin/relais"));
  assert.ok(!links(sidebar("admin", "/admin/parametres?tab=school", false)).includes("/admin/relais"));
});

test("le financier conserve son menu métier", () => {
  const html = sidebar("finance_manager", "/admin/finance/payments");
  assert.ok(html.includes("Gestion financière"));
  assert.ok(links(html).includes("/admin/finance/payments"));
  assert.ok(!html.includes("Correspondant fichier"));
});

test("le dashboard est réellement partagé et ses raccourcis respectent le profil", () => {
  const render = (role) => renderToStaticMarkup(h(AdminRoleContext.Provider, { value: role }, h(Dashboard)));
  const admin = render("admin");
  const correspondent = render("file_correspondent");
  for (const label of ["Classes", "Enseignants", "Parents", "Élèves", "Affectés", "Non affectés", "Internes", "Non internes", "Garçons", "Filles", "Absences / période", "Retards / période"]) {
    assert.ok(admin.includes(label), label);
    assert.ok(correspondent.includes(label), label);
  }
  assert.ok(links(admin).includes("/admin/users"));
  assert.ok(links(admin).includes("/admin/statistiques"));
  assert.ok(!links(correspondent).includes("/admin/users"));
  assert.ok(!links(correspondent).includes("/admin/statistiques"));
  assert.ok(links(correspondent).every(isFileCorrespondentPathAllowed));
});

test("le shell Correspondant accepte le dashboard et masque une route interdite", () => {
  location = new URL("https://example.test/admin/dashboard");
  const allowed = renderToStaticMarkup(h(RestrictedShell, null, "Contenu autorisé"));
  assert.ok(allowed.includes("Contenu autorisé"));
  assert.ok(allowed.includes("Correspondant fichier · Établissement"));
  assert.ok(links(allowed).every(isFileCorrespondentPathAllowed));
  location = new URL("https://example.test/admin/users");
  const denied = renderToStaticMarkup(h(RestrictedShell, null, "Contenu interdit"));
  assert.ok(!denied.includes("Contenu interdit"));
  assert.ok(denied.includes("Redirection"));
});

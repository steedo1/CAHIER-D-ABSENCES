import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("le téléphone de classe masque toute information Relais sans capacité active", async () => {
  const page = await read("src/app/class/page.tsx");

  assert.match(page, /useRelayCapability/);
  assert.match(page, /const relayUiEnabled =[\s\S]*?relayCapabilityResolved[\s\S]*?relayEnabled/);
  assert.match(
    page,
    /if \(!relayUiEnabled\) \{[\s\S]*?setRelayScheduleIssue\(null\)/,
  );
  assert.match(
    page,
    /\{relayUiEnabled && \([\s\S]*?Relais local : \{connectivityLabel\(relayStatus\)\}/,
  );
  assert.match(page, /: "L'appel continue via le Cloud\."/);
  assert.match(
    page,
    /: "Internet indisponible\. L'appel est sécurisé sur ce téléphone et sera synchronisé automatiquement\."/,
  );
  assert.match(
    page,
    /: "L’appareil conserve l’appel et réessaiera le Cloud automatiquement\."/,
  );
});

test("l'interface enseignant emploie des messages Cloud et GPS neutres sans Relais", async () => {
  const dashboard = await read("src/components/teacher/TeacherDashboard.tsx");

  assert.match(dashboard, /relayEnabled: institutionHasRelay/);
  assert.match(
    dashboard,
    /: "La vérification de présence n’est pas disponible pour cet appel\."/,
  );
  assert.match(
    dashboard,
    /: "Vérification ponctuelle de votre position GPS…"/,
  );
  assert.match(
    dashboard,
    /: "Le Cloud est indisponible pour ouvrir cette séance\."/,
  );
  assert.match(
    dashboard,
    /: "L’appel sera enregistré avant la fermeture\. L’heure de fin enregistrée sera utilisée/,
  );
});

test("la surveillance admin ne cite pas le Relais quand il n'est pas activé", async () => {
  const matrix = await read("src/app/admin/absences/appels-matrice/page.tsx");

  assert.match(matrix, /const \{ relayEnabled \} = useRelayCapability\(\)/);
  assert.match(
    matrix,
    /relayEnabled[\s\S]*?\? "Cloud et relais indisponibles[\s\S]*?: "Cloud indisponible : la dernière vue locale valide reste affichée"/,
  );
});

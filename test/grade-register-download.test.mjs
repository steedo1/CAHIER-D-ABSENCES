import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { downloadGradeRegisterPdf } from "../src/lib/grades/grade-register-download.ts";

test("un clic produit un fichier PDF valide et téléchargeable sans API de notes", async () => {
  const originalFetch = globalThis.fetch;
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const fontBytes = fs.readFileSync(new URL("../public/card-fonts/DejaVuSans.ttf", import.meta.url));
  let capturedBlob = null;
  let clicked = false;
  let downloadName = "";
  let fontRequests = 0;

  try {
    globalThis.fetch = async (url) => {
      assert.equal(url, "/card-fonts/DejaVuSans.ttf", "aucune lecture réseau des notes");
      fontRequests++;
      return new Response(fontBytes, { status: 200 });
    };
    URL.createObjectURL = (blob) => {
      capturedBlob = blob;
      return "blob:test-pdf";
    };
    URL.revokeObjectURL = () => {};
    globalThis.document = {
      body: { appendChild: () => {} },
      createElement: (tag) => {
        assert.equal(tag, "a");
        return {
          href: "",
          set download(value) { downloadName = value; },
          get download() { return downloadName; },
          click() { clicked = true; },
          remove() {},
        };
      },
    };
    globalThis.window = { setTimeout: () => 1 };

    const filename = await downloadGradeRegisterPdf({
      institutionName: "EPC Dimbokro",
      academicYear: "2026-2027",
      className: "CE1 — Français",
      subjectName: "EDHC",
      periodName: "Année scolaire entière",
      teachingName: "Enseignement français",
      students: [
        { id: "a", full_name: "KONE Aïcha", matricule: "EPC260001" },
        { id: "b", full_name: "TRAORE Karim", matricule: "EPC260002" },
      ],
      evaluations: [
        { id: "eval1", label: "Note 1", scale: 10, eval_date: "2026-11-02", coeff: 1 },
        { id: "eval2", label: "Note 2", scale: 10, eval_date: "2026-11-03", coeff: 1 },
      ],
      grades: {
        eval1: { a: 0, b: 8 },
        eval2: { a: 9, b: null },
      },
    });
    assert.equal(fontRequests, 1);
    assert.equal(clicked, true);
    assert.equal(filename, downloadName);
    assert.match(filename, /\.pdf$/);
    assert.ok(capturedBlob instanceof Blob);
    assert.equal(capturedBlob.type, "application/pdf");
    assert.ok(capturedBlob.size > 2000, "le PDF doit être généré et non vide");
    assert.match(Buffer.from(await capturedBlob.arrayBuffer()).subarray(0, 8).toString("ascii"), /^%PDF-/);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  }
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const routeSource = readFileSync(
  new URL("../src/app/api/admin/grades/bulletin/route.ts", import.meta.url), "utf8",
);
const ast = ts.createSourceFile("bulletin-route.ts", routeSource, ts.ScriptTarget.Latest, true);
const statement = ast.statements.find(
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === "attachQrPng",
);
assert.ok(statement, "attachQrPng must exist");

function loadAttachQrPng(encode, warnings = []) {
  const compiled = ts.transpileModule(statement.getText(ast), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function("createBulletinQrDataUrl", "QRCode", "console",
    compiled + "\nreturn attachQrPng;",
  )(
    encode,
    { toDataURL: async (url) => `image:${url}` },
    { warn: (...args) => warnings.push(args) },
  );
}

test("Render: QR de 120 élèves bornés à deux encodages, ordre conservé", async () => {
  let active = 0, peak = 0;
  const attachQrPng = loadAttachQrPng(async (url, options, render) => {
    active++;
    peak = Math.max(peak, active);
    try {
      await new Promise(resolve => setTimeout(resolve, 1));
      assert.equal(options.width, 600);
      return render(url, options);
    } finally {
      active--;
    }
  });
  const input = Array.from({ length: 120 }, (_, i) => ({
    student_id: String(i), qr_url: `https://www.mon-cahier.com/v/TEST${i}`,
  }));
  const output = await attachQrPng(input);
  assert.equal(peak, 2);
  assert.equal(active, 0);
  assert.equal(output.length, input.length);
  input.forEach((student, i) => {
    assert.equal(output[i].student_id, student.student_id);
    assert.equal(output[i].qr_url, student.qr_url);
    assert.equal(output[i].qr_png, `image:${student.qr_url}`);
    assert.equal(student.qr_png, undefined);
  });
});

test("Render: QR impossibles conservés sans image et journalisés une seule fois", async () => {
  const warnings = [];
  const attachQrPng = loadAttachQrPng(async (url, options, render) => {
    if (url.includes("INVALID")) throw new Error("The amount of data is too big");
    return render(url, options);
  }, warnings);
  const input = [
    { student_id: "a", qr_url: null },
    ...Array.from({ length: 25 }, (_, i) => ({
      student_id: String(i), qr_url: `https://www.mon-cahier.com/verify/bulletin?t=INVALID${i}`,
    })),
    { student_id: "last", qr_url: "https://www.mon-cahier.com/v/SHORT" },
  ];
  const result = await attachQrPng(input);
  assert.equal(result.length, input.length);
  assert.equal(result[0].qr_png, null);
  assert.equal(result.at(-1).qr_png, "image:https://www.mon-cahier.com/v/SHORT");
  for (let i = 1; i <= 25; i++) {
    assert.equal(result[i].qr_png, null);
    assert.equal(result[i].qr_url, input[i].qr_url);
  }
  assert.equal(warnings.length, 1);
  assert.match(warnings[0][0], /génération du QR impossible/);
  assert.equal(warnings[0][1].failed_count, 25);
  assert.equal(warnings[0][1].total_count, 27);
  assert.ok(warnings[0][1].max_url_length > 0);
  assert.equal(JSON.stringify(warnings).includes("INVALID"), false);
});

test("Render: lot vide ou unité sans ressource ni avertissement inutile", async () => {
  let count = 0;
  const warnings = [];
  const attachQrPng = loadAttachQrPng(async (url, opts, render) => {
    count++;
    return render(url, opts);
  }, warnings);
  assert.deepEqual(await attachQrPng([]), []);
  assert.equal(count, 0);
  assert.deepEqual(await attachQrPng([{ qr_url: null, student_id: "x" }]), [
    { qr_url: null, student_id: "x", qr_png: null },
  ]);
  assert.equal(count, 0);
  assert.equal(warnings.length, 0);
});

test("Render: les URLs impossibles de plus de 2953 octets ne sont jamais envoyées à l'encodeur", async () => {
  const warnings = [];
  let encodeCount = 0;
  const attachQrPng = loadAttachQrPng(async (url, options, render) => {
    encodeCount++;
    return render(url, options);
  }, warnings);
  const longUrl = "https://www.mon-cahier.com/verify/bulletin?t=" + "a".repeat(3000);
  const utf8Url = "https://www.mon-cahier.com/v/" + "é".repeat(1500);
  const shortUrl = "https://www.mon-cahier.com/v/SHORT";
  const result = await attachQrPng([
    { student_id: "long", qr_url: longUrl, qr_token: "historic-token" },
    { student_id: "utf8", qr_url: utf8Url },
    { student_id: "short", qr_url: shortUrl },
  ]);
  assert.equal(encodeCount, 1, "only the short URL enters the QR encoder");
  assert.equal(result[0].qr_png, null);
  assert.equal(result[0].qr_url, longUrl);
  assert.equal(result[0].qr_token, "historic-token");
  assert.equal(result[1].qr_png, null);
  assert.equal(result[2].qr_png, `image:${shortUrl}`);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][1].failed_count, 2);
});

test("Render: limite exacte de 2953 octets laissée à l'encodeur", async () => {
  let count = 0;
  const attachQrPng = loadAttachQrPng(async (url, options, render) => {
    count++;
    return render(url, options);
  });
  const prefix = "https://www.mon-cahier.com/v/";
  const url = prefix + "A".repeat(2953 - Buffer.byteLength(prefix));
  assert.equal(Buffer.byteLength(url), 2953);
  const result = await attachQrPng([{ student_id: "boundary", qr_url: url }]);
  assert.equal(count, 1);
  assert.equal(result[0].qr_png, `image:${url}`);
});

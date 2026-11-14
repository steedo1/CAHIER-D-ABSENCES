import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import PDFDocument from "pdfkit";
import { PDFParse } from "pdf-parse";
import sharp from "sharp";
import { productionUpload } from "../src/lib/production-nexa.ts";
import { renderCardPages } from "../src/lib/school-card-pdf.ts";
import { createFixtureRouteLoader } from "./helpers/multicycle-fixture.mjs";
import { schoolCardFixture, request, year } from "./helpers/school-card-fixture.mjs";

process.env.SCHOOL_CARDS_ENABLED = "true";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fixture-only-production-ticket-key-at-least-32";
const api = "/api/production-nexa";
const admin = "/api/admin/school-cards";
const superApi = "/api/super/production-nexa";
const route = path => `src/app${path}/route.ts`;
const renderFont = await readFile("public/card-fonts/DejaVuSans.ttf");

function fixture(count = 3) {
  const db = schoolCardFixture(count, true);
  const now = new Date();
  db.tables.academic_years[0].start_date = `${now.getUTCFullYear() - 1}-01-01`;
  db.tables.academic_years[0].end_date = `${now.getUTCFullYear() + 1}-12-31`;
  db.tables.class_enrollments.forEach(row => { row.start_date = db.tables.academic_years[0].start_date; });
  db.tables.institutions[0].code = "E020684";
  db.tables.nexa_production_accounts = [];
  db.tables.nexa_card_preparations = [];
  db.tables.nexa_card_orders = [];
  db.tables.nexa_card_archives = [];
  db.service.auth = { admin: {
    createUser: async ({ email, password, role }) => {
      const user = { ...db.user(randomUUID(), email), role };
      db.users.set(user.id, { user, password });
      return { data: { user }, error: null };
    },
    deleteUser: async id => db.users.delete(id),
  } };
  db.service.rpc = async (fn, args) => {
    assert.equal(fn, "nexa_prepare_cards");
    const { p_school: institution_id, p_year: academic_year, p_actor: submitted_by, p_students: student_ids, p_order } = args;
    for (const id of student_ids) {
      if (!db.tables.nexa_card_preparations.some(row => row.institution_id === institution_id && row.academic_year === academic_year && row.student_id === id)) {
        db.tables.nexa_card_preparations.push({ institution_id, academic_year, student_id: id });
      }
    }
    if (!p_order) return { data: null, error: null };
    let order = db.tables.nexa_card_orders.find(item => JSON.stringify(item.student_ids) === JSON.stringify(student_ids));
    if (!order) {
      order = { id: randomUUID(), institution_id, academic_year, submitted_by, student_ids, status: "pending", revision: 1,
        created_at: now.toISOString() };
      db.tables.nexa_card_orders.push(order);
    }
    return { data: order.id, error: null };
  };
  const storage = db.service.storage.from;
  db.service.storage.from = bucket => {
    const implementation = storage(bucket);
    return { ...implementation,
      download: path => {
        const task = implementation.download(path);
        return Object.assign(task, { asStream: async () => {
          const result = await task;
          return { data: result.data?.stream(), error: result.error };
        } });
      },
      upload: async (path, bytes, options) => db.files.has(path)
        ? { data: null, error: { statusCode: "409", message: "already exists" } }
        : implementation.upload(path, bytes, options),
    };
  };
  return db;
}
async function create(db, overrides = {}) {
  const response = await db.load(db.superId)(route(superApi)).POST(request(superApi, {
    action: "create", email: "production@example.invalid", status: "active", allSchools: false, institutionIds: [db.legacyId],
    permissions: ["cards.read", "cards.orders", "cards.generate", "cards.download"], ...overrides,
  }));
  assert.equal(response.status, 201);
  const { account, password } = await response.json();
  assert.ok(password.length > 28);
  // Defaults assigned by the migration; the transport fixture has no SQL.
  db.tables.nexa_production_accounts[0].revision = 1;
  assert.equal(db.users.get(account.user_id).user.role, "nexa_production");
  return account.user_id;
}
function archiveRequest(ticket, pdf, items) {
  const body = productionUpload(new Blob([new Uint8Array(pdf)]), items.map(item =>
    ({ id: item.studentId, name: item.name, matricule: item.matricule })));
  const url = new URL(`https://cards.example.invalid${api}/archive`);
  return Object.assign(new Request(url, { method: "POST", headers: {
    origin: url.origin, "Content-Type": body.type, "X-Nexa-Production-Ticket": ticket,
  }, body }), { nextUrl: url });
}
async function generatedPdf(data) {
  const doc = new PDFDocument({ autoFirstPage: false });
  const parts = [];
  const complete = new Promise((resolve, reject) => {
    doc.on("data", part => parts.push(part));
    doc.on("end", () => resolve(Buffer.concat(parts)));
    doc.on("error", reject);
  });
  renderCardPages(doc, data.items, data.school, { font: renderFont, photos: new Map(), signatures: data.signatures, stamps: data.stamps },
    { individual: true });
  doc.end();
  return complete;
}
test("Supervision creates and disables an independent account with explicit school and capability checks", async () => {
  const db = fixture();
  const actor = await create(db, { permissions: ["cards.read"] });
  const load = db.load(actor);
  assert.equal((await load(route(admin)).GET(request(admin))).status, 403);
  assert.equal((await load(route(superApi)).GET(request(superApi))).status, 403);
  assert.equal((await load(route(api)).GET(request(`${api}?school=${randomUUID()}&view=years`))).status, 403);
  const scoped = await (await load(route(api)).GET(request(api))).json();
  assert.deepEqual(scoped.schools.map(school => school.id), [db.legacyId]);
  assert.equal((await load(route(api)).POST(request(api, { action: "generation", school: db.legacyId, year }))).status, 403);
  const superRoute = db.load(db.superId)(route(superApi));
  const change = status => superRoute.POST(request(superApi, {
    action: "update", userId: actor, status, revision: 1, allSchools: false, institutionIds: [db.legacyId], permissions: ["cards.read"],
  }));
  assert.equal((await change("disabled")).status, 200);
  assert.equal((await load(route(api)).GET(request(api))).status, 403);
  assert.equal((await change("active")).status, 409);
});
test("Production can prepare a selected roster batch during generation without creating an order", async () => {
  const db = fixture();
  const actor = await create(db);
  const production = db.load(actor)(route(api));
  const student = db.tables.students[0];
  const payload = {
    action: "generation", school: db.legacyId, year, studentIds: [student.id],
    format: "pvc", flip: "long", allowMissing: true,
  };
  const generate = (overrides = {}) => production.POST(request(api, { ...payload, ...overrides }));

  assert.equal((await generate()).status, 409);
  assert.equal((await generate({ prepareSelection: true, allowMissing: false })).status, 409);
  assert.equal((await generate({ prepareSelection: true, studentIds: [randomUUID()] })).status, 403);
  assert.equal((await generate({ prepareSelection: true, orderId: randomUUID() })).status, 409);
  assert.equal((await db.admin(route(api)).POST(request(api, { ...payload, prepareSelection: true }))).status, 403);
  assert.equal(db.tables.nexa_card_preparations.length, 0);

  const response = await generate({ prepareSelection: true });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.ok(data.ticket);
  assert.deepEqual(data.items.map(item => item.studentId), [student.id]);
  assert.deepEqual(db.tables.nexa_card_preparations.map(item => item.student_id), [student.id]);
  assert.equal(db.tables.nexa_card_orders.length, 0);
  assert.equal((await generate()).status, 200);
});

test("School prepares and orders; scoped Production selects EPC cards, archives, reuses, versions and downloads", async () => {
  const db = fixture();
  const actor = await create(db);
  const [french, arabic] = db.tables.classes;
  const bilingualId = db.tables.students[0].id;
  db.tables.institutions[0].settings_json.school_student_programs_v1.years[year].classes[arabic.id].linkedStudentIds = [bilingualId];
  const orderApi = db.admin(route(`${admin}/orders`));
  const studentIds = db.tables.students.map(row => row.id);
  const submit = ids => orderApi.POST(request(`${admin}/orders`, { action: "order", year, studentIds: ids }));
  const first = await (await submit([...studentIds, bilingualId])).json();
  const second = await (await submit(studentIds.reverse())).json();
  assert.equal(first.orderId, second.orderId);
  assert.equal(first.count, 3);
  assert.equal((await submit([randomUUID()])).status, 403);
  assert.equal((await db.admin(route(api)).GET(request(api))).status, 403);
  const load = db.load(actor), production = load(route(api));
  const scope = `school=${db.legacyId}&year=${year}`;
  const orders = await (await production.GET(request(`${api}?${scope}&view=orders`))).json();
  assert.equal(orders.orders[0].id, first.orderId);
  assert.equal(orders.orders[0].student_ids.length, 3);
  const roster = await (await production.GET(request(`${api}?${scope}`))).json();
  assert.equal(roster.preparedIds.length, 3);
  assert.deepEqual(roster.items.find(row => row.studentId === bilingualId).classes.map(row => row.id), [french.id, arabic.id]);
  assert.equal(db.calls.some(call => call.op === "sign-batch"), false);
  const transition = (status, revision) => production.POST(request(api, {
    school: db.legacyId, year, action: "orderStatus", orderId: first.orderId, status, revision,
  }));
  assert.equal((await transition("preparing", 1)).status, 200);
  assert.equal((await transition("ready", 1)).status, 409);

  const generate = (previousId = null) => production.POST(request(api, {
    school: db.legacyId, year, action: "generation", orderId: first.orderId, previousId,
    studentIds: [bilingualId, bilingualId], format: "pvc", flip: "long", allowMissing: true,
  }));
  const data = await (await generate()).json();
  assert.ok(data.ticket);
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].token, undefined);
  const pdf = await generatedPdf(data);
  const parser = new PDFParse({ data: new Uint8Array(pdf) });
  try {
    const parsed = await parser.getText();
    assert.equal(parsed.total, 2);
    assert.match(parsed.text, /CP1 FR/);
    assert.match(parsed.text, /CP1 AR/);
    assert.doesNotMatch(parsed.text, /NON VALABLE|verifier-carte/);
  } finally { await parser.destroy(); }
  const save = load(route(`${api}/archive`));
  assert.equal((await db.admin(route(`${api}/archive`)).POST(archiveRequest(data.ticket, pdf, data.items))).status, 403);
  assert.equal((await save.POST(archiveRequest(data.ticket.slice(0, -2), pdf, data.items))).status, 403);
  assert.equal((await save.POST(archiveRequest(data.ticket, pdf, data.items.map(item => ({ ...item, name: "Modified" })) ))).status, 400);
  const firstSave = await save.POST(archiveRequest(data.ticket, pdf, data.items));
  assert.equal(firstSave.status, 201);
  const { archive } = await firstSave.json();
  assert.equal((await save.POST(archiveRequest(data.ticket, pdf, data.items))).status, 200);
  assert.equal(db.files.size, 1);
  assert.equal((await (await generate()).json()).archive.id, archive.id);
  // Simulate a restart after storing v2 but before persisting its metadata.
  const corrected = await (await generate(archive.id)).json();
  const ticket = load("src/lib/server/production-nexa.ts").openGenerationTicket(corrected.ticket, actor);
  db.files.set(`${db.legacyId}/${year}/${ticket.id}.pdf`, pdf);
  const secondSave = await save.POST(archiveRequest(corrected.ticket, pdf, corrected.items));
  assert.equal(secondSave.status, 201);
  const version = (await secondSave.json()).archive;
  assert.equal(version.version, 2);
  assert.equal(version.previous_id, archive.id);
  assert.equal((await generate(archive.id)).status, 409);
  const params = Promise.resolve({ id: archive.id });
  const download = request(`${api}/archive/${archive.id}?school=${db.legacyId}`);
  assert.equal((await db.admin(route(`${api}/archive/[id]`)).GET(download, { params })).status, 403);
  const file = await load(route(`${api}/archive/[id]`)).GET(download, { params });
  assert.equal(file.status, 200);
  assert.equal(file.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), pdf);
  assert.equal(db.tables.nexa_production_audit.filter(event => event.action === "downloaded").length, 1);
  assert.equal(db.calls.some(call => call.table === "bulletin_qr_codes"), false);
});
test("School preview only returns two bounded raster images and checks the enrolment", async () => {
  const db = fixture(1);
  const school = db.tables.institutions[0];
  const image = await sharp({ create: { width: 250, height: 250, channels: 3, background: "#208070" } }).png().toBuffer();
  school.logo_url = `data:image/png;base64,${image.toString("base64")}`;
  const loader = createFixtureRouteLoader(db, db.legacyAdminId);
  const preview = id => loader(route(admin)).POST(request(admin, { action: "preview", year, studentId: id }));
  assert.equal((await preview(randomUUID())).status, 403);
  const response = await preview(db.tables.students[0].id);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ["back", "front"]);
  for (const raster of Object.values(body)) {
    assert.match(raster, /^data:image\/jpeg;base64,/);
    const bytes = Buffer.from(raster.split(",")[1], "base64");
    const properties = await sharp(bytes).metadata();
    assert.equal(properties.width, 480);
    assert.ok(bytes.length < 45_000);
  }
});

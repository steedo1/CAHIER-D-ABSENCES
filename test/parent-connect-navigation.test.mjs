import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import React, { act } from 'react';
import { Window } from 'happy-dom';
import ts from 'typescript';

// Real React page and DOM events; only the authenticated API is simulated.
// No school data, payment provider, or live database is accessed.
const window = new Window({ url: 'https://example.test/admin/parent-connect' });
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'Event', 'MouseEvent']) {
  Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? window : window[name] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
window.HTMLDialogElement.prototype.close = function () { this.open = false; };
const { createRoot } = await import('react-dom/client');
const require = createRequire(import.meta.url);
function load(relative) {
  const source = fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((id) => {
    if (id === 'next/link') return { __esModule: true, default: ({ href, children, prefetch: _prefetch, ...props }) => React.createElement('a', { ...props, href }, children) };
    if (id === '@/lib/parent-connect/domain') return load('src/lib/parent-connect/domain.ts');
    return require(id);
  }, module, module.exports);
  return module.exports;
}
const Page = load('src/app/admin/parent-connect/page.tsx').default;
const endsAt = '2027-07-12T00:00:00Z';
const students = [
  { id: 's1', full_name: 'KOUADIO ANGE', matricule: 'MAT001', class_label: '6ème A', class_id: 'c1', level: '6ème', parent_connect: { status: 'inactive', allowed: false, ends_at: null } },
  { id: 's2', full_name: 'YAO ALICE', matricule: 'MAT002', class_label: '5ème B', class_id: 'c2', level: '5ème', parent_connect: { status: 'inactive', allowed: false, ends_at: null } },
];

async function mount({ canCollect = true, canConfigure = true, failOnce = false, credits = 10, covered = false } = {}) {
  const calls = [];
  const items = structuredClone(students);
  if (covered) { items[0].coverage_source = 'school_cover'; items[0].parent_connect = { status: 'active', allowed: true, ends_at: endsAt }; }
  let fail = failOnce;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url, window.location.origin);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method: init.method || 'GET', params: u.searchParams, body });
    if (init.method === 'POST') {
      if (fail) { fail = false; throw new TypeError('Connexion interrompue'); }
      if (body.action === 'phone') { items.find(s=>s.id===body.student_id).sms_phone_e164 = '+2250700000000'; return Response.json({phone_change:{}}); }
      const student = items.find((s) => s.id === body.student_id);
      student.parent_connect = { status: 'active', allowed: true, ends_at: endsAt };
      return Response.json({ activation: { ends_at: endsAt } });
    }
    const q = (u.searchParams.get('q') || '').toLowerCase();
    const filtered = items.filter((s) => (!u.searchParams.get('level') || s.level === u.searchParams.get('level')) && (!u.searchParams.get('class_id') || s.class_id === u.searchParams.get('class_id')) && (!q || `${s.full_name} ${s.matricule}`.toLowerCase().includes(q)));
    return Response.json({ institution_name: 'École test', enforcement_enabled: true, can_activate: canCollect, can_configure: canConfigure, academic_year: '2026-2027', school_end_date: '2027-07-11', activations_paused: false, classes: [{ id: 'c1', label: '6ème A', level: '6ème', academic_year: '2026-2027' }, { id: 'c2', label: '5ème B', level: '5ème', academic_year: '2026-2027' }], items: filtered, page: 0, total: filtered.length, roster: { eligible_count: 513, skipped_no_matricule: 16 }, summary: { subscriptions_active: 0, collected: 0, school_share: 0, nexa_share: 0, credits_available: credits, nexa_received: 15000, pending_remittances: 0, school_covered: covered ? 1 : 0 }, payments: [], remittances: [] });
  };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(React.createElement(Page)); });
  return { container, calls, close: async () => { await act(async () => root.unmount()); container.remove(); } };
}
async function change(element, value) {
  await act(async () => {
    const prototype = element.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
    element.dispatchEvent(new window.Event('input', { bubbles: true }));
    element.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
}
async function click(element) { assert.ok(element, 'bouton trouvé'); await act(async () => element.click()); }
const button = (container, text) => [...container.querySelectorAll('button')].find((b) => b.textContent.includes(text));

await test('niveau puis classe affiche la liste et active le bon matricule en un clic sans paiement', async () => {
  const ui = await mount();
  try {
    assert.ok(ui.container.textContent.includes('Élèves activés'));
    assert.ok(ui.container.textContent.includes('529 élèves inscrits cette année'));
    assert.ok(ui.container.textContent.includes('16 sans matricule'));
    for(const label of ['Part établissement','Reçu par Nexa','Versements à confirmer','par enfant','2 000','1 500','Encaisser','encaissement','Montant reçu','Payeur','Versements à Nexa']) assert.ok(!ui.container.textContent.includes(label), label);
    assert.ok(ui.container.textContent.includes('KOUADIO ANGE'));
    const selects = ui.container.querySelectorAll('form select');
    await change(selects[0], '6ème');
    assert.ok(!selects[1].textContent.includes('5ème B'));
    await change(selects[1], 'c1');
    assert.equal(ui.calls.at(-1).params.get('level'), '6ème');
    assert.equal(ui.calls.at(-1).params.get('class_id'), 'c1');
    assert.ok(!ui.container.textContent.includes('YAO ALICE'));
    assert.ok(ui.container.textContent.includes('529 élèves inscrits cette année'));
    await click(button(ui.container, 'Activer'));
    assert.equal(ui.container.querySelector('dialog').open, false);
    const payment = ui.calls.find((c) => c.method === 'POST').body;
    assert.equal(payment.action, 'activate'); assert.equal(payment.student_id, 's1'); for (const key of ['amount','payer_name','payment_method','sms_phone']) assert.ok(!(key in payment));
    assert.equal(ui.calls.filter(c=>c.method==='POST').length,1); assert.match(payment.operation_id, /^[0-9a-f-]{36}$/);
    assert.ok(ui.container.textContent.includes('matricule activé'));
    assert.equal(button(ui.container, 'Déjà activé').disabled, true);
    assert.ok(ui.container.textContent.includes('11/07/2027'));
    assert.equal(payment.academic_year, '2026-2027');
    assert.ok(!ui.container.textContent.includes('12 mois'));
  } finally { await ui.close(); }
});
await test('la recherche directe par prénom retrouve l’enfant sans choisir de classe', async () => {
  const ui = await mount();
  try {
    await change(ui.container.querySelector('input[placeholder]'), 'Alice');
    await act(async () => ui.container.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
    assert.equal(ui.calls.at(-1).params.get('q'), 'Alice');
    assert.equal(ui.calls.at(-1).params.get('class_id'), '');
    assert.ok(ui.container.textContent.includes('YAO ALICE')); assert.ok(!ui.container.textContent.includes('KOUADIO ANGE'));
  } finally { await ui.close(); }
});
await test('le Correspondant consulte sans boutons d’encaissement ni changement du mode', async () => {
  const ui = await mount({ canCollect: false, canConfigure: false });
  try {
    assert.ok(ui.container.textContent.includes('Consultation des abonnements'));
    assert.equal(button(ui.container, 'Activer'), undefined);
    assert.equal(button(ui.container, 'Revenir à l’accès actuel'), undefined);
    assert.equal(ui.calls.filter((c) => c.method !== 'GET').length, 0);
  } finally { await ui.close(); }
});
await test('une coupure permet de réessayer avec le même identifiant d’activation', async () => {
  const ui = await mount({ failOnce: true });
  try {
    await click(button(ui.container, 'Activer'));
    const submit = async () => click(button(ui.container, 'Activer'));
    assert.ok(ui.container.textContent.includes('Connexion interrompue'));
    await submit();
    const payments = ui.calls.filter((c) => c.method === 'POST');
    assert.equal(payments.length, 2); assert.equal(payments[0].body.operation_id, payments[1].body.operation_id);
    assert.ok(ui.container.textContent.includes('matricule activé'));
  } finally { await ui.close(); }
});
await test('sans crédits, aucune activation ne peut être lancé', async () => {
 const ui = await mount({credits:0});try { assert.equal(button(ui.container,'Activer').disabled,true); await click(button(ui.container,'Activer')); assert.equal(ui.container.querySelector('dialog').open,false); assert.ok(ui.container.textContent.includes('Aucun crédit disponible')); }finally {await ui.close();}
});
await test('un élève pris en charge par l’école ne paie pas une deuxième fois',async()=>{
 const ui=await mount({covered:true});try{ assert.equal(button(ui.container,'Déjà activé').disabled,true); assert.ok(ui.container.textContent.includes('Pris en charge par l’établissement'));assert.equal(ui.calls.filter(c=>c.method==='POST').length,0); }finally{await ui.close();}
});
await test('CSCA couvert sans crédit : ajouter le numéro sans encaisser ni activer les SMS',async()=>{
 const ui=await mount({covered:true,credits:0});try {
  await click(button(ui.container,'Ajouter le numéro SMS'));await change(ui.container.querySelector('dialog input[type=tel]'),'07 00 00 00 00');
  assert.ok(!ui.container.querySelector('dialog').textContent.includes('Mode de règlement'));
  await act(async()=>ui.container.querySelector('dialog form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));
  const body=ui.calls.find(c=>c.method==='POST').body;assert.equal(body.action,'phone');assert.equal(body.expected_phone,null);assert.ok(!('payment_method' in body));
  assert.ok(ui.container.textContent.includes('Numéro SMS enregistré')); assert.ok(ui.container.textContent.includes('+2250700000000'));
 } finally {await ui.close();}
});
await window.happyDOM.abort();

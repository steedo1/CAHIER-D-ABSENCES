import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../public/moncahier-sw.js', import.meta.url), 'utf8');

function fixture({ delay = 3500, status = 200, never = false } = {}) {
  let now = 0, nextId = 0, requests = 0;
  const timers = new Map();
  const schedule = (fn, ms) => { const id = ++nextId; timers.set(id, { at: now + ms, fn }); return id; };
  const context = vm.createContext({
    self: { addEventListener() {}, navigator: {}, location: { origin: 'https://school.invalid' } },
    URL, Request, Response, Headers, AbortController, DOMException, console,
    setTimeout: schedule, clearTimeout: id => timers.delete(id),
    fetch: (_request, { signal } = {}) => {
      requests++;
      return new Promise((resolve, reject) => {
        const id = never ? null : schedule(() => resolve(Response.json({ items: [{ id: 'math', label: 'Mathématiques' }] }, { status })), delay);
        signal?.addEventListener('abort', () => { timers.delete(id); reject(signal.reason); }, { once: true });
      });
    },
  });
  vm.runInContext(source, context);
  return {
    requests: () => requests,
    async advance(ms) {
      const until = now + ms;
      for (;;) {
        const next = [...timers.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at; timers.delete(next[0]); next[1].fn();
        await setImmediate();
      }
      now = until; await setImmediate();
    },
    read(preparing = false, slot = true) {
      const url = new URL('https://school.invalid/api/class/subjects?class_id=3e2');
      if (slot) url.searchParams.set('slot', '3|07:15|08:10');
      if (preparing) url.searchParams.set('offline_preparation', 'v1');
      context.inputUrl = url;
      context.inputRequest = new Request(url, { referrer: 'https://school.invalid/class' });
      return vm.runInContext('classDeviceSubjectsResponse(inputRequest, inputUrl)', context);
    },
  };
}

test('une matière Cloud reçue après 3,5 secondes reste visible sur un téléphone déjà prêt', async () => {
  const f = fixture(); const result = f.read(); await f.advance(3500);
  const response = await result;
  assert.equal(response.status, 200);
  assert.equal((await response.json()).items[0].id, 'math');
  assert.equal(f.requests(), 1);
});

test('la préparation accepte un créneau reçu en 12 secondes sans répéter la requête', async () => {
  const f = fixture({ delay: 12000 }); const result = f.read(true); await f.advance(12000);
  assert.equal((await result).status, 200); assert.equal(f.requests(), 1);
});

for (const [preparing, limit] of [[false, 8000], [true, 20000]]) {
  test(`une panne réseau reste bornée à ${limit} ms, sans réponse de matière inventée`, async () => {
    const f = fixture({ never: true }); const result = f.read(preparing);
    let settled = false; void result.then(() => { settled = true; });
    await f.advance(limit - 1); assert.equal(settled, false);
    await f.advance(1);
    const response = await result;
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, 'class_device_subject_slot_unavailable');
    assert.equal(f.requests(), 1);
  });
}

for (const status of [401, 403, 409, 503]) {
  test(`le refus Cloud ${status} reste inchangé, sans nouvelle requête`, async () => {
    const f = fixture({ delay: 100, status }); const result = f.read(); await f.advance(100);
    assert.equal((await result).status, status); assert.equal(f.requests(), 1);
  });
}

test('un appel sans créneau ne récupère pas la liste générale des matières', async () => {
  const f = fixture(); const response = await f.read(false, false);
  assert.deepEqual((await response.json()).items, []); assert.equal(f.requests(), 0);
});

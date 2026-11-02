import assert from 'node:assert/strict';
import test from 'node:test';
import { acquireServerWork } from '../src/lib/server-work-lock';
import { dispatchOrigin, triggerDispatch } from '../src/lib/dispatch-trigger';
import { createReferenceFetch } from '../src/lib/supabase-reference-fetch';
test('dispatch: 40 simultaneous wakeups send one HTTP request and consume/cancel its body', async () => {
    const original = globalThis.fetch;
    const env = { ...process.env };
    process.env.CRON_SECRET = 'synthetic-test-secret';
    process.env.RENDER_EXTERNAL_URL = 'https://mon-cahier-test.onrender.com';
    let calls = 0, cancelled = 0;
    let release;
    globalThis.fetch = async (url, init) => {
        calls++;
        assert.equal(String(url), 'https://mon-cahier-test.onrender.com/api/push/dispatch');
        assert.equal(init?.redirect, 'error');
        await new Promise(r => { release = r; });
        return new Response(new ReadableStream({ cancel() { cancelled++; } }));
    };
    try {
        const work = Array.from({ length: 40 }, () => triggerDispatch('push'));
        assert.equal(calls, 1);
        release();
        assert.deepEqual(await Promise.all(work), Array(40).fill(true));
        assert.equal(cancelled, 1);
        const next = triggerDispatch('push');
        assert.equal(calls, 2);
        release();
        await next;
    }
    finally {
        globalThis.fetch = original;
        process.env = env;
    }
});
test('dispatch: canonical Render origin and untrusted request host never receives secret', async () => {
    assert.equal(dispatchOrigin('https://www.mon-cahier-test.onrender.com/a'), 'https://mon-cahier-test.onrender.com');
    assert.throws(() => dispatchOrigin('https://user:password@example.com'));
    const env = { ...process.env }, original = globalThis.fetch;
    process.env.CRON_SECRET = 'synthetic';
    process.env.RENDER_EXTERNAL_URL = 'https://mon-cahier-test.onrender.com';
    let calls = 0;
    globalThis.fetch = async (url) => { calls++; assert.equal(new URL(String(url)).host, 'mon-cahier-test.onrender.com'); throw Error('timeout with unknown outcome'); };
    try {
        assert.equal(await triggerDispatch('push', { req: new Request('https://attacker.invalid', { headers: { host: 'attacker.invalid' } }), retries: 3 }), false);
        assert.equal(calls, 1);
    }
    finally {
        globalThis.fetch = original;
        process.env = env;
    }
});
test('work locks exclude duplicates, allow independent channels and recover after failure', () => {
    const release = acquireServerWork('push');
    assert.ok(release);
    assert.equal(acquireServerWork('push'), null);
    const sms = acquireServerWork('sms');
    assert.ok(sms);
    sms();
    try {
        throw Error('fixture failure');
    }
    catch { }
    finally {
        release();
    }
    acquireServerWork('push')();
});
test('reference cache bounds bytes and never retains oversized responses', async () => {
    let reads = 0;
    const payload = 'x'.repeat(128 * 1024);
    const url = (n) => `https://project.supabase.co/rest/v1/classes?select=id,label&institution_id=eq.school-${n}`;
    const fetcher = createReferenceFetch(async () => { reads++; return new Response(payload); });
    for (let i = 0; i < 40; i++)
        assert.equal((await (await fetcher(url(i))).text()).length, payload.length);
    assert.equal(reads, 40);
    await (await fetcher(url(39))).text();
    assert.equal(reads, 40);
    await (await fetcher(url(0))).text();
    assert.equal(reads, 41, 'oldest entry evicted at 4 MiB');
    let largeReads = 0;
    const large = createReferenceFetch(async () => { largeReads++; return new Response('x'.repeat(300 * 1024)); });
    await (await large(url(0))).text();
    await (await large(url(0))).text();
    assert.equal(largeReads, 2);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import { createClient } from '@supabase/supabase-js';
import { acquireServerWork } from '../src/lib/server-work-lock';
const require = createRequire(import.meta.url);
const code = ts.transpileModule(readFileSync('src/app/api/push/dispatch/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
function fixture({ subscribed = true, fail = false } = {}) {
    const calls = [], sends = [];
    let release;
    const db = createClient('https://synthetic.invalid', 'synthetic', { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (input, init = {}) => {
                const table = new URL(String(input)).pathname.split('/').at(-1);
                const body = init.body ? JSON.parse(init.body) : null;
                calls.push({ table, body, method: init.method });
                if (table === 'claim_notification_dispatch_batch') {
                    if (fail)
                        throw Error('synthetic database failure');
                    assert.equal(body.p_limit, 25);
                    return Response.json([{ id: 'queue-a', institution_id: 'school', profile_id: 'actor', channels: ['push', 'inapp'], payload: { title: 'synthetic' }, attempts: 0 }]);
                }
                if (table === 'institution_notification_channel_settings')
                    return Response.json([{ institution_id: 'school', push_enabled: true }]);
                if (table === 'push_subscriptions')
                    return Response.json(subscribed ? [{ user_id: 'actor', platform: 'web', subscription_json: { endpoint: 'https://push.invalid/synthetic' } }] : []);
                if (table === 'notifications_queue' && init.method === 'PATCH')
                    return Response.json([]);
                throw Error('unexpected fixture query ' + table);
            } } });
    const deps = {
        'next/server': require('next/server'), '@/lib/supabaseAdmin': { getSupabaseServiceClient: () => db },
        '@/lib/server-work-lock': { acquireServerWork },
        '@/lib/grades/primary-notification-policy': { filterPrimaryOfficialNotifications: async (_db, rows) => rows },
        '@/lib/parent-connect/server': { filterParentConnectQueue: async (_db, rows) => rows },
        'web-push': { setVapidDetails() { }, sendNotification: async (...args) => { sends.push(args); await new Promise(r => { release = r; }); return { statusCode: 201 }; } },
    };
    const mod = { exports: {} };
    new Function('require', 'module', 'exports', 'process', 'console', code)((name) => { assert.ok(name in deps, name); return deps[name]; }, mod, mod.exports, { env: { CRON_SECRET: 'synthetic', VAPID_PUBLIC_KEY: 'synthetic', VAPID_PRIVATE_KEY: 'synthetic' } }, { info() { }, warn() { }, error() { }, debug() { } });
    return { route: mod.exports, calls, sends, release: () => release(), req: (valid = true) => new Request('https://app.invalid/api/push/dispatch', { method: 'POST', headers: { 'x-cron-secret': valid ? 'synthetic' : 'invalid' } }) };
}
test('push preserves authorization; overlapping authenticated workers claim a single batch', async () => {
    const f = fixture();
    assert.equal((await f.route.POST(f.req(false))).status, 403);
    assert.equal(f.calls.length, 0);
    const first = f.route.POST(f.req());
    while (!f.sends.length)
        await new Promise(r => setTimeout(r, 0));
    assert.equal((await f.route.POST(f.req())).status, 202);
    assert.equal(f.calls.filter(c => c.table === 'claim_notification_dispatch_batch').length, 1);
    assert.equal(f.sends[0][2].timeout, 10_000);
    f.release();
    assert.equal((await (await first).json()).sent_device_sends, 1);
    assert.ok(f.calls.some(c => c.table === 'notifications_queue' && c.body.status === 'sent'));
});
test('no subscription: no provider call, in-app payload retained, row skipped without consuming attempts', async () => {
    const f = fixture({ subscribed: false });
    const result = await (await f.route.POST(f.req())).json();
    assert.equal(result.attempted, 1);
    assert.equal(f.sends.length, 0);
    const update = f.calls.find(c => c.table === 'notifications_queue');
    assert.equal(update.body.status, 'skipped');
    assert.equal(update.body.attempts, 0);
    assert.equal(update.body.payload, undefined);
});
test('work lock releases after a database failure', async () => {
    const f = fixture({ fail: true });
    await f.route.POST(f.req());
    const healthy = fixture({ subscribed: false });
    assert.equal((await healthy.route.POST(healthy.req())).status, 200);
});

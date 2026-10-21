// Compare built servers locally with synthetic credentials and identical traffic.
// Usage: node scripts/measure-runtime-memory.mjs label /tmp/result.json [requests=600] [concurrency=8] [next|standalone|npm] [school]
// npm mode measures the actual package start script. To test a heap candidate,
// temporarily set that script on the isolated checkout, then restore it.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';

const [label, output, requestArg = '600', concurrencyArg = '8', mode = 'next', schoolMode] = process.argv.slice(2);
assert(label && output, 'Supply label and output JSON path');
const requests = Number(requestArg), concurrency = Number(concurrencyArg);
const heapMiB = Number(process.env.MON_CAHIER_BENCH_HEAP_MIB || 4096);
assert(Number.isInteger(heapMiB) && heapMiB >= 128 && heapMiB <= 4096);
assert(Number.isInteger(requests) && requests > 0 && requests <= 100_000);
assert(Number.isInteger(concurrency) && concurrency > 0 && concurrency <= 32);
assert(['next', 'standalone', 'npm'].includes(mode));
if (mode === 'npm') assert(process.env.MON_CAHIER_BENCH_NPM_CLI, 'Set MON_CAHIER_BENCH_NPM_CLI to the absolute npm-cli.js path');
const root = fileURLToPath(new URL('../', import.meta.url));
// Point this at a copy outside the repository to detect missing traced files
// rather than accidentally resolving them from the root node_modules.
const serverRoot = mode === 'standalone'
  ? (process.env.MON_CAHIER_BENCH_STANDALONE_DIR || root + '.next/standalone') : root;
const port = 3137;
const origin = `http://127.0.0.1:${port}`;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const samples = [], responses = [];
let phase = 'startup', logs = '';
const started = performance.now();
const auditDir = mode === 'npm' ? await mkdtemp(join(tmpdir(), 'mon-cahier-npm-')) : null;
const auditFile = auditDir && join(auditDir, 'memory.jsonl');
const phases = [{ at: Date.now(), phase }];
const setPhase = value => { phase = value; phases.push({ at: Date.now(), phase }); };
const school = schoolMode === 'school'
  ? await (await import('./memory-school-fixture.mjs')).startMemorySchoolFixture() : null;
const child = spawn(process.execPath, mode === 'npm' ? [
  process.env.MON_CAHIER_BENCH_NPM_CLI, 'run', 'start', '--', '--hostname', '127.0.0.1', '--port', String(port),
] : [
  `--max-old-space-size=${heapMiB}`,
  '--require', fileURLToPath(new URL('./runtime-memory-probe.cjs', import.meta.url)),
  ...(mode === 'standalone' ? ['server.js'] :
    ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)]),
], {
  cwd: serverRoot,
  env: {
    ...process.env,
    NODE_ENV: 'production',
    // Deliberately retain the build-size value to verify that the explicit
    // runtime flag takes precedence, as it would in the proposed Render command.
    NODE_OPTIONS: '--max-old-space-size=4096' + (mode === 'npm'
      ? ` --require=${fileURLToPath(new URL('./runtime-memory-probe.cjs', import.meta.url))}` : ''),
    PATH: dirname(process.execPath) + ':' + process.env.PATH,
    ...(auditFile ? { MON_CAHIER_LOCAL_MEMORY_AUDIT_FILE: auditFile } : {}),
    NEXT_TELEMETRY_DISABLED: '1',
    MON_CAHIER_LOCAL_MEMORY_AUDIT: '1',
    PORT: String(port),
    HOSTNAME: '127.0.0.1',
    SUPABASE_URL: 'http://127.0.0.1:54321',
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'isolated-audit-anon',
    SUPABASE_ANON_KEY: 'isolated-audit-anon',
    SUPABASE_SERVICE_ROLE_KEY: 'isolated-audit-service',
  },
  stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  // npm does not reliably forward SIGTERM to its shell/server child. Keep the
  // entire local benchmark in its own process group so cleanup reaches both.
  detached: mode === 'npm',
});
child.on('message', sample => { if (sample.type === 'memory') samples.push({ phase, ...sample }); });
for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { logs = (logs + chunk).slice(-32_000); });
const paths = [
  ['/', 200], ['/login', 200], ['/recover', 200],
  ['/manifest.webmanifest', 200], ['/moncahier-sw.js', 200], ['/offline.html', 200],
  ['/class', 307], ['/admin', 307], ['/api/class/roster', 401],
];
if (school) paths.push(
  [`/api/class/roster?class_id=${school.classId}`, 200, school.headers, school.rosterCount],
  [`/api/teacher/roster?class_id=${school.classId}`, 200, school.headers, school.rosterCount],
  ['/api/admin/students', 200, school.headers, school.studentCount],
);
async function request(path, expected, headers, expectedItems) {
  const begin = performance.now();
  const response = await fetch(origin + path, { headers, redirect: 'manual', signal: AbortSignal.timeout(30_000) });
  const body = await response.arrayBuffer();
  const bytes = body.byteLength;
  const expectedStatuses = Array.isArray(expected) ? expected : [expected];
  assert(expectedStatuses.includes(response.status), `${path}: unexpected ${response.status}: ${Buffer.from(body).toString().slice(0, 500)}`);
  if (expectedItems !== undefined) assert.equal(JSON.parse(Buffer.from(body).toString()).items.length, expectedItems, path);
  if (expected === 307) assert(new URL(response.headers.get('location')).pathname === '/login');
  responses.push({ phase, path, status: response.status, ms: performance.now() - begin, bytes });
}
function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return { min: sorted[0], median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))], max: sorted.at(-1) };
}
async function stop() {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  const kill = signal => {
    try { if (mode === 'npm') process.kill(-child.pid, signal); else child.kill(signal); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  };
  kill('SIGTERM');
  const force = setTimeout(() => kill('SIGKILL'), 5_000);
  try { await exited; } finally { clearTimeout(force); }
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void stop(); });
try {
  const deadline = performance.now() + 120_000;
  while (!/Ready in/.test(logs)) {
    assert(child.exitCode === null && child.signalCode === null, `Server exited: ${logs}`);
    assert(performance.now() < deadline, `Startup timed out: ${logs}`);
    await pause(100);
  }
  const readyMs = performance.now() - started;
  setPhase('idle'); await pause(5_000);
  setPhase('warmup');
  for (const route of paths) await request(...route);
  if (school) {
    // Load the main school modules too, without authorizing any business writes.
    for (const path of [
      '/api/admin/grades/bulletin', '/api/admin/exports/averages',
      '/api/admin/exports/averages/diagnostic', '/api/admin/classes',
      '/api/teacher/offline/bootstrap', '/api/teacher/classes',
      '/api/teacher/grades/evaluations', '/api/teacher/grades/averages',
      '/api/teacher/grades/exports', '/api/teacher/grades/scores',
      '/api/class/me', '/api/class/my-classes', '/api/class/subjects', '/api/auth/role',
    ]) await request(path, [200, 400, 401, 403, 405]);
  }
  // Include actual built JS and Next image processing without any remote image.
  const html = await (await fetch(origin + '/login')).text();
  const asset = html.match(/src="([^\"]+\/_next\/static\/[^\"]+\.js)"/)?.[1]
    || html.match(/src="(\/_next\/static\/[^\"]+\.js)"/)?.[1];
  if (asset?.startsWith('/')) paths.push([asset, 200]);
  paths.push(['/_next/image?url=%2Fnexa-digital-logo.png&w=96&q=75', 200]);
  setPhase('load');
  const loadStarted = performance.now();
  let next = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < requests) {
      const i = next++;
      await request(...paths[i % paths.length]);
    }
  }));
  const loadMs = performance.now() - loadStarted;
  setPhase('settled'); await pause(10_000);
  let npmSamples = [];
  if (auditFile) {
    const rows = (await readFile(auditFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    for (const row of rows) row.phase = phases.findLast(p => p.at <= row.at)?.phase || 'startup';
    samples.push(...rows.filter(row => row.argv.some(arg => arg.endsWith('/next'))));
    npmSamples = rows.filter(row => row.argv.some(arg => arg.endsWith('/npm-cli.js')));
    assert(samples.length > 0 && npmSamples.length > 0, 'Missing Next/npm memory samples');
  }
  const last = samples.at(-1);
  const firstLoad = samples.find(s => s.phase === 'load');
  const lastLoad = samples.findLast(s => s.phase === 'load');
  const cpuSeconds = firstLoad && lastLoad ? ((lastLoad.cpu.user + lastLoad.cpu.system) - (firstLoad.cpu.user + firstLoad.cpu.system)) / 1e6 : null;
  const summary = {
    label, node: process.version, next: JSON.parse(await readFile(root + 'node_modules/next/package.json')).version,
    mode, heapMiB: mode === 'npm' ? null : heapMiB, requests, concurrency, readyMs, loadMs, cpuSeconds,
    schoolFixture: school ? { classes: 20, students: school.studentCount, requests: school.counts } : null,
    totalCpuSeconds: (last.cpu.user + last.cpu.system) / 1e6,
    osPeakRssMiB: last.maxRssKiB / 1024,
    phases: Object.fromEntries(['idle', 'warmup', 'load', 'settled'].map(p => {
      const rows = samples.filter(s => s.phase === p);
      return [p, { count: rows.length, rssMiB: stats(rows.map(s => s.rss / 2 ** 20)), heapMiB: stats(rows.map(s => s.heapUsed / 2 ** 20)), externalMiB: stats(rows.map(s => s.external / 2 ** 20)) }];
    })),
    responseMs: stats(responses.filter(r => r.phase === 'load').map(r => r.ms)),
    last, allExpectedStatuses: true,
    ...(npmSamples.length ? {
      npmParentSettledRssMiB: npmSamples.at(-1).rss / 2 ** 20,
      combinedSettledRssMiB: (last.rss + npmSamples.at(-1).rss) / 2 ** 20,
      combinedPeakSampledRssMiB: Math.max(...samples.map(row => {
        const parent = npmSamples.reduce((best, p) => Math.abs(p.at - row.at) < Math.abs(best.at - row.at) ? p : best);
        return (row.rss + parent.rss) / 2 ** 20;
      })),
    } : {}),
  };
  await writeFile(output, JSON.stringify({ summary, samples, npmSamples, responses }, null, 2) + '\n');
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
} catch (error) {
  await writeFile(output, JSON.stringify({ label, error: String(error), samples, serverLog: logs }, null, 2));
  throw error;
} finally { await stop(); if (school) await school.close(); if (auditDir) await rm(auditDir, { recursive: true, force: true }); }

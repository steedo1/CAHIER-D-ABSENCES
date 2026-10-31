import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function load(path, imports = {}) {
  const exports = {};
  new Function('exports', 'require', compile(read(path)))(exports, name => {
    assert.ok(name in imports, `Unexpected import ${name}`); return imports[name];
  });
  return exports;
}
function declaration(name) {
  const ast = ts.createSourceFile('readiness.ts', read('src/lib/offline-readiness.ts'), ts.ScriptTarget.Latest, true);
  return ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name).getText(ast);
}
test('actual installed fetch guard lets preparation finish beyond 1.8s while interactive reads remain bounded', async () => {
  const timers = [], native = async () => {
    await new Promise(resolve => setTimeout(resolve, 45)); // virtual 4.5s network
    return Response.json({ periods: [{ id: 'period' }] });
  };
  const context = vm.createContext({ exports: {}, fetch: native, Response, Request, Headers, URL, DOMException,
    AbortController, navigator: { onLine: true }, location: { origin: 'https://fixture.invalid' },
    addEventListener() {}, setTimeout: (fn, ms) => { timers.push(ms); return setTimeout(fn, ms / 100); }, clearTimeout,
  });
  vm.runInContext('window = globalThis', context);
  vm.runInContext(compile(read('src/lib/attendance-network.ts')), context);
  await assert.rejects(context.fetch('/api/teacher/institution/basics'), { name: 'TimeoutError' });
  vm.runInContext(compile(declaration('responseMessage') + '\n' + declaration('fetchFreshJson')) + '; download = fetchFreshJson;', context);
  const result = await context.download('/api/teacher/institution/basics?offline_preparation=v1');
  assert.equal(result.periods.length, 1);
  assert.equal(timers.filter(ms => ms === 1800).length, 1, 'preparation must bypass the global fast-path timer');
  assert.ok(timers.includes(20000));
});

function fixture({ allowed = true, anonymous = false, truncated = false, changed = false, missingSubject = false, orphan = false, size = 37 } = {}) {
  const periods = Array.from({ length: size }, (_, i) => ({ id: `p${i}`, institution_id: 'school',
    weekday: 1 + Math.floor(i / 8), start_time: `${String(7 + i % 8).padStart(2, '0')}:00:00`, end_time: `${String(8 + i % 8).padStart(2, '0')}:00:00` }));
  const tables = {
    classes: [{ id: 'class', institution_id: 'school', education_type: 'general' }],
    institutions: [{ id: 'school', tz: 'Africa/Abidjan' }],
    attendance_schedule_revisions: [{ institution_id: 'school', revision: 10, preparation_revision: 5 }],
    institution_periods: periods,
    teacher_timetables: periods.slice(0, -1).map(p => ({ institution_id: 'school', class_id: 'class', period_id: p.id, subject_id: 'canonical-math' })),
    institution_subjects: missingSubject ? [] : [
      { id: 'math', subject_id: 'canonical-math', institution_id: 'school', custom_name: 'Mathématiques' },
      { id: 'english', subject_id: 'canonical-english', institution_id: 'school', custom_name: 'Anglais' },
      { id: 'foreign-math', subject_id: 'canonical-math', institution_id: 'other', custom_name: 'Must not leak' },
    ], subjects: [],
  };
  tables.teacher_timetables.push({ institution_id: 'school', class_id: 'class', period_id: orphan ? 'deleted-period' : 'p0', subject_id: 'english' });
  const queries = [];
  const service = { from(table) {
    queries.push(table); let rows = [...(tables[table] || [])], exact = false;
    const query = {
      select(_fields, options) { exact = options?.count === 'exact'; return query; },
      eq(key, value) { rows = rows.filter(row => row[key] === value); return query; },
      in(key, values) { rows = rows.filter(row => values.includes(row[key])); return query; },
      order() { return query; },
      maybeSingle: async () => ({ data: rows[0] || null, error: null }),
      then(resolve, reject) { return Promise.resolve({ data: rows, error: null,
        count: exact ? rows.length + (truncated && table === 'teacher_timetables' ? 1 : 0) : null }).then(resolve, reject); },
    }; return query;
  } };
  const route = load('src/app/api/class/subjects/route.ts', {
    'next/server': { NextResponse: { json: (body, options) => Response.json(body, options) } },
    '@/lib/supabase-server': { getSupabaseServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: anonymous ? null : { id: 'device', phone: 'unused' } } }) } }) },
    '@/lib/supabaseAdmin': { getSupabaseServiceClient: () => service },
    '@/lib/education-attendance': { isNonGeneralAttendanceEducation: () => false, attendanceClassContextIsComplete: () => true },
    '@/lib/class-device-identity': { classDeviceMayAccessClass: async () => allowed },
    '@/lib/attendance-schedule-revision-server': {
      readAttendancePreparationSnapshot: async () => ({ schedule_revision: 11, preparation_revision: changed ? 6 : 5 }),
      attendancePreparationSnapshotsMatch: (a,b) => a.preparation_revision === b.preparation_revision,
    },
  });
  return { queries, run: () => route.GET({ url: 'https://fixture.invalid/api/class/subjects?class_id=class&offline_preparation=v1&all_slots=1' }) };
}
for (const size of [1, 37, 48]) test(`weekly route: ${size} periods use a fixed number of scoped reads, preserve simultaneous subjects and empty slots`, async () => {
  const f = fixture({ size }); const response = await f.run(); const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.slots.length, size);
  assert.equal(body.actor_profile_id, 'device'); assert.equal(body.class_id, 'class');
  assert.equal(body.snapshot_completeness, 'complete');
  assert.deepEqual(body.slots[0].items.map(i => i.id).sort(), size === 1 ? ['english'] : ['english','math']);
  if (size > 1) assert.deepEqual(body.slots.at(-1).items, []);
  assert.equal(f.queries.filter(t => t === 'teacher_timetables').length, 1);
  assert.equal(f.queries.filter(t => t === 'institution_periods').length, 1);
  assert.ok(f.queries.length <= 8);
  assert.match(response.headers.get('cache-control'), /private, no-store/);
});
for (const [options, status] of [[{ anonymous: true },401], [{allowed:false},403], [{truncated:true},503], [{changed:true},409], [{missingSubject:true},409], [{orphan:true},409]]) {
  test(`weekly route refuses incomplete or unauthorized snapshots: ${JSON.stringify(options)}`, async () => {
    const f = fixture(options); const response = await f.run();
    assert.equal(response.status, status); assert.notEqual((await response.json()).snapshot_completeness, 'complete');
    if (options.anonymous || options.allowed === false) assert.ok(!f.queries.includes('teacher_timetables'));
  });
}
test('dedicated bootstrap URL enforces weekly mode and preserves authenticated request headers', async () => {
  let delegated;
  class NextRequest extends Request {}
  const api = load('src/app/api/class/offline/bootstrap/route.ts', {
    'next/server': { NextRequest }, '../../subjects/route': { GET: async req => { delegated = req; return Response.json({ ok:true }); } },
  });
  await api.GET(new NextRequest('https://fixture.invalid/api/class/offline/bootstrap?class_id=c', { headers: { Cookie:'session=fixture' } }));
  assert.equal(new URL(delegated.url).searchParams.get('all_slots'),'1');
  assert.equal(new URL(delegated.url).searchParams.get('offline_preparation'),'v1');
  assert.equal(delegated.headers.get('cookie'),'session=fixture');
});

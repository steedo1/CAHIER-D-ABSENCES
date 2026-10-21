// Synthetic read-only Supabase HTTP fixture; never connects to a real project.
import { createServer } from 'node:http';

export async function startMemorySchoolFixture() {
  const institutionId = '11111111-1111-4111-8111-111111111111';
  const userId = '22222222-2222-4222-8222-222222222222';
  const uuid = n => `33333333-3333-4333-8333-${String(n).padStart(12, '0')}`;
  const classes = Array.from({ length: 20 }, (_, i) => ({
    id: uuid(i + 1), institution_id: institutionId, label: `6e ${i + 1}`, level: '6e',
    academic_year: '2026-2027', class_device_auth_user_id: userId,
    education_type: 'general_secondary', formation_code: null,
  }));
  const enrollments = classes.flatMap(c => Array.from({ length: 60 }, (_, i) => {
    const studentId = uuid(1000 + classes.indexOf(c) * 60 + i);
    return { id: uuid(3000 + classes.indexOf(c) * 60 + i), student_id: studentId,
      institution_id: institutionId, class_id: c.id, academic_year: c.academic_year, end_date: null,
      students: { id: studentId, first_name: `Prenom ${i}`, last_name: `Eleve ${i}`,
        matricule: `SYNTH-${studentId}`, gender: i % 2 ? 'F' : 'M' }, classes: c };
  }));
  const user = { id: userId, aud: 'authenticated', role: 'authenticated',
    email: 'memory-audit@example.invalid', app_metadata: {}, user_metadata: {} };
  const tables = {
    institutions: [{ id: institutionId, name: 'Ecole synthetique', settings_json: {} }],
    profiles: [{ id: userId, institution_id: institutionId, display_name: 'Audit synthetique' }],
    user_roles: ['teacher', 'class_device', 'admin'].map(role => ({ profile_id: userId, institution_id: institutionId, role })),
    academic_years: [{ institution_id: institutionId, code: '2026-2027', is_current: true }],
    classes, class_enrollments: enrollments,
    teacher_sessions: [{ id: uuid(9000), class_id: classes[0].id, teacher_id: userId, ended_at: null }],
  };
  const counts = {};
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    counts[url.pathname] = (counts[url.pathname] || 0) + 1;
    res.setHeader('Content-Type', 'application/json');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405); res.end(JSON.stringify({ error: 'fixture_is_read_only' })); return;
    }
    if (url.pathname === '/auth/v1/user') { res.end(JSON.stringify(user)); return; }
    const table = url.pathname.match(/^\/rest\/v1\/(\w+)$/)?.[1];
    if (!table || !tables[table]) {
      res.writeHead(404); res.end(JSON.stringify({ message: 'unknown_fixture_path', path: url.pathname })); return;
    }
    let rows = tables[table];
    for (const [key, expression] of url.searchParams) {
      if (['select', 'order', 'limit', 'offset'].includes(key)) continue;
      const value = row => key.split('.').reduce((v, k) => v?.[k], row);
      if (expression.startsWith('eq.')) rows = rows.filter(row => String(value(row)) === expression.slice(3));
      else if (expression === 'is.null') rows = rows.filter(row => value(row) == null);
      else if (expression.startsWith('in.(')) {
        const allowed = expression.slice(4, -1).split(',').map(v => v.replaceAll('"', ''));
        rows = rows.filter(row => allowed.includes(String(value(row))));
      } else {
        res.writeHead(400); res.end(JSON.stringify({ message: 'unsupported_fixture_filter', key, expression })); return;
      }
    }
    const total = rows.length;
    const range = String(req.headers.range || '').match(/(\d+)-(\d+)/);
    const offset = Number(url.searchParams.get('offset') || range?.[1] || 0);
    const limit = Number(url.searchParams.get('limit') || (range ? Number(range[2]) - offset + 1 : total));
    rows = rows.slice(offset, offset + limit);
    res.setHeader('Content-Range', `${offset}-${offset + rows.length - 1}/${total}`);
    const result = String(req.headers.accept).includes('object+json') ? rows[0] || null : rows;
    res.end(req.method === 'HEAD' ? undefined : JSON.stringify(result));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(54321, '127.0.0.1', resolve); });
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const token = `header.${Buffer.from(JSON.stringify({ exp: expires, sub: userId })).toString('base64url')}.signature`;
  const session = { access_token: token, refresh_token: 'synthetic-refresh', expires_at: expires, expires_in: 3600, token_type: 'bearer', user };
  return {
    headers: { cookie: `mca-auth-v1=${encodeURIComponent(JSON.stringify(session))}` },
    classId: classes[0].id, studentCount: enrollments.length, rosterCount: 60, counts,
    async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); },
  };
}

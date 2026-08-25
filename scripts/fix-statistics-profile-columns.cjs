const fs = require('fs');
const path = 'src/app/api/admin/statistics/route.ts';
let s = fs.readFileSync(path, 'utf8');
const before = s;
s = s.replace('  const ln = String(p?.last_name ?? "").trim();\n  const fn = String(p?.first_name ?? "").trim();\n', '');
s = s.replace('    `${ln} ${fn}`.trim() ||\n', '');
s = s.replaceAll('.select("id, display_name, first_name, last_name, email, phone")', '.select("id, display_name, email, phone")');
if (s === before) {
  throw new Error('Aucun remplacement appliqué: vérifier la route statistics.');
}
if (s.includes('first_name') || s.includes('last_name')) {
  throw new Error('Des références first_name/last_name subsistent dans statistics/route.ts');
}
fs.writeFileSync(path, s);
console.log('statistics profile columns patched');

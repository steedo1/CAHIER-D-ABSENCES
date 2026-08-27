from pathlib import Path

route_path = Path("src/app/api/admin/students/import/route.ts")
test_path = Path("test/student-year-transition-and-import-policy.test.mjs")
route = route_path.read_text(encoding="utf-8")

old = '''  const { data: looseExisting, error: looseExistingErr } = await srv
    .from("students")
    .select(
      "id, matricule, full_name, full_name_key, first_name, last_name, gender, birthdate, birth_place, nationality, lv2, regime, is_repeater, is_boarder, is_affecte, photo_url",
    )
    .eq("institution_id", inst);

  if (looseExistingErr) {
    return NextResponse.json({ error: looseExistingErr.message }, { status: 400 });
  }

  for (const s of looseExisting ?? []) {
'''
new = '''  const looseExisting: any[] = [];
  const loosePageSize = 1000;
  for (let from = 0; ; from += loosePageSize) {
    const { data: loosePage, error: loosePageErr } = await srv
      .from("students")
      .select(
        "id, matricule, full_name, full_name_key, first_name, last_name, gender, birthdate, birth_place, nationality, lv2, regime, is_repeater, is_boarder, is_affecte, photo_url",
      )
      .eq("institution_id", inst)
      .range(from, from + loosePageSize - 1);

    if (loosePageErr) {
      return NextResponse.json({ error: loosePageErr.message }, { status: 400 });
    }
    looseExisting.push(...(loosePage ?? []));
    if ((loosePage?.length ?? 0) < loosePageSize) break;
  }

  for (const s of looseExisting) {
'''
if old not in route:
    raise SystemExit("loose identity query block not found")
route = route.replace(old, new, 1)
route_path.write_text(route, encoding="utf-8")

tests = test_path.read_text(encoding="utf-8")
tests = tests.replace(
    '  assert.match(code, /const existingByLooseNameKey/);\n',
    '  assert.match(code, /const existingByLooseNameKey/);\n  assert.match(code, /const loosePageSize = 1000/);\n  assert.match(code, /\\.range\\(from, from \\+ loosePageSize - 1\\)/);\n',
    1,
)
test_path.write_text(tests, encoding="utf-8")

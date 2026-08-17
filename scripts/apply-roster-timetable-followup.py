from pathlib import Path


def load(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def save(path: str, text: str) -> None:
    Path(path).write_text(text, encoding="utf-8")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly 1 match, got {count}")
    return text.replace(old, new, 1)


# ---------------------------------------------------------------------------
# 1) Printable class roster: grouped note columns, private-school title,
#    stronger institution-logo watermark.
# ---------------------------------------------------------------------------
path = "src/app/admin/classes/liste/[id]/page.tsx"
text = load(path)

anchor = '''function boardingShort(value: boolean | null | undefined) {
  // Convention demandée : externe = EXT ; interne = cellule vide.
  if (value === false) return "EXT";
  return "";
}
'''
replacement = anchor + '''
function normalizeInstitutionRoleText(value: string | null | undefined) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\\u0300-\\u036f]/g, "")
    .toLowerCase();
}

function classListHeadRoleLabel(
  institution: ClassListPayload["institution"] | null | undefined,
) {
  const haystack = normalizeInstitutionRoleText(
    [institution?.status, institution?.head_title].filter(Boolean).join(" "),
  );

  if (
    haystack.includes("directeur des etudes") ||
    haystack.includes("directrice des etudes") ||
    haystack.includes("prive") ||
    haystack.includes("private")
  ) {
    return "Directeur des études";
  }

  return "Chef d’établissement";
}
'''
text = replace_once(text, anchor, replacement, "private-school head role helper")

old = '''          padding: 14px 18px 18px;
          font-family: Arial, Helvetica, sans-serif;
          overflow: hidden;
        }

        .official-header {'''
new = '''          padding: 14px 18px 18px;
          font-family: Arial, Helvetica, sans-serif;
          overflow: hidden;
          position: relative;
          isolation: isolate;
        }

        .class-list-watermark {
          position: absolute;
          left: 50%;
          top: 54%;
          width: min(40%, 340px);
          max-height: 72%;
          transform: translate(-50%, -50%);
          object-fit: contain;
          opacity: 0.12;
          filter: grayscale(0.08) saturate(0.9);
          pointer-events: none;
          user-select: none;
          z-index: 4;
        }

        .official-header {'''
text = replace_once(text, old, new, "watermark css")

text = replace_once(
    text,
    '''        @media print {
          html,''',
    '''        @media print {
          .class-list-watermark {
            width: 78mm !important;
            opacity: 0.14 !important;
          }

          html,''',
    "print watermark css",
)

text = replace_once(
    text,
    '''          <article className="class-list-sheet">
            <header className="official-header">''',
    '''          <article className="class-list-sheet">
            {data.institution.logo_url ? (
              <img
                src={data.institution.logo_url}
                alt=""
                aria-hidden="true"
                className="class-list-watermark"
              />
            ) : null}
            <header className="official-header">''',
    "watermark image",
)

text = replace_once(
    text,
    '''              <div>
                <strong>Chef d’établissement :</strong>{" "}
                {data.institution.head_name || "À renseigner"}
              </div>''',
    '''              <div>
                <strong>{classListHeadRoleLabel(data.institution)} :</strong>{" "}
                {data.institution.head_name || "À renseigner"}
              </div>''',
    "private-school head role label",
)

old_header = '''                  <th className="col-no">N°</th>
                  <th className="col-matricule">Matricule</th>
                  <th className="col-name">Nom et prénoms</th>
                  <th className="col-series">Note1</th>
                  <th className="col-affect">Aff.</th>
                  <th className="col-board">Note2</th>
                  <th className="col-date">Né(e) le</th>
                  <th className="col-sex">Sexe</th>
                  <th className="col-red">Red</th>
                  <th className="col-lv2">Note3</th>
                  <th className="col-nat">Note4</th>'''
new_header = '''                  <th className="col-no">N°</th>
                  <th className="col-matricule">Matricule</th>
                  <th className="col-name">Nom et prénoms</th>
                  <th className="col-series">Note1</th>
                  <th className="col-board">Note2</th>
                  <th className="col-lv2">Note3</th>
                  <th className="col-nat">Note4</th>
                  <th className="col-affect">Aff.</th>
                  <th className="col-date">Né(e) le</th>
                  <th className="col-sex">Sexe</th>
                  <th className="col-red">Red</th>'''
text = replace_once(text, old_header, new_header, "group note headers")

old_cells = '''                      <td className="col-series"></td>
                      <td className="col-affect">
                        {affectationShort(student.is_affecte)}
                      </td>
                      <td className="col-board"></td>
                      <td className="col-date">
                        {formatDateFR(student.birthdate)}
                      </td>
                      <td className="col-sex">{sexShort(student.gender)}</td>
                      <td className="col-red">
                        {student.is_repeater ? "R" : ""}
                      </td>
                      <td className="col-lv2"></td>
                      <td className="col-nat"></td>'''
new_cells = '''                      <td className="col-series"></td>
                      <td className="col-board"></td>
                      <td className="col-lv2"></td>
                      <td className="col-nat"></td>
                      <td className="col-affect">
                        {affectationShort(student.is_affecte)}
                      </td>
                      <td className="col-date">
                        {formatDateFR(student.birthdate)}
                      </td>
                      <td className="col-sex">{sexShort(student.gender)}</td>
                      <td className="col-red">
                        {student.is_repeater ? "R" : ""}
                      </td>'''
text = replace_once(text, old_cells, new_cells, "group note cells")
save(path, text)


# ---------------------------------------------------------------------------
# 2) Timetable warnings: describe the actual existing occupation instead of
#    showing the generic word "conflict".
# ---------------------------------------------------------------------------
path = "src/app/admin/import-emplois-du-temps/page.tsx"
text = load(path)

text = replace_once(
    text,
    '''        messages.push(
          `Classe déjà occupée par ${occupancyTeacherLabel(row)} (${occupancySubjectLabel(row)}).`,
        );''',
    '''        messages.push(
          `Matière présente : ${occupancySubjectLabel(row)} avec ${occupancyTeacherLabel(row)} dans cette classe.`,
        );''',
    "class occupancy message",
)

text = replace_once(
    text,
    '''        messages.push(
          `${selectedTeacherLabel || "Ce professeur"} est déjà prévu en ${row.class_label || "une autre classe"}.`,
        );''',
    '''        messages.push(
          `Professeur déjà présent : ${selectedTeacherLabel || "Ce professeur"} est prévu en ${row.class_label || "une autre classe"} sur ce créneau.`,
        );''',
    "teacher occupancy message",
)

anchor = '''  const activeConflictMessages = activeCell
    ? Array.from('''
helper = '''  function conflictStatusLabel(messages: string[], includePermission = true) {
    let label = "Occupation présente";
    if (messages.some((message) => message.startsWith("Matière présente"))) {
      label = "Matière présente";
    } else if (
      messages.some((message) => message.startsWith("Professeur déjà présent"))
    ) {
      label = "Professeur déjà présent";
    }
    return includePermission
      ? `${label} — enregistrement autorisé`
      : label;
  }

'''
if anchor not in text:
    raise SystemExit("conflict status helper anchor missing")
text = text.replace(anchor, helper + anchor, 1)

text = replace_once(
    text,
    '''                                          Conflit signalé''',
    '''                                          {conflictStatusLabel(conflictMessages, false)}''',
    "grid warning label",
)

text = replace_once(
    text,
    '''                        <div className="font-semibold">
                          Conflit signalé — enregistrement autorisé.
                        </div>''',
    '''                        <div className="font-semibold">
                          {conflictStatusLabel(activeConflictMessages)}.
                        </div>''',
    "active warning title",
)

old_side = '''                                <span className="mt-0.5 block text-[10px] font-semibold text-amber-800">
                                  Conflit signalé — enregistrement autorisé
                                </span>'''
new_side = '''                                <span className="mt-0.5 block text-[10px] font-semibold text-amber-800">
                                  {conflictStatusLabel(conflictMessages)}
                                </span>'''
count = text.count(old_side)
if count != 2:
    raise SystemExit(f"sidebar warning labels: expected 2 matches, got {count}")
text = text.replace(old_side, new_side)

text = text.replace(
    "Les chevauchements sont signalés en orange, sans bloquer la saisie.",
    "Les occupations déjà présentes sont précisées en orange, sans bloquer la saisie.",
)
save(path, text)


# ---------------------------------------------------------------------------
# 3) Focused regression test.
# ---------------------------------------------------------------------------
path = "test/timetable-roster-ux.test.mjs"
text = load(path)

old_test = '''test("printed roster uses four blank note columns instead of unused columns", () => {
  const roster = (read("src/app/admin/classes/liste/[id]/page.tsx").split('<table className="roster-table">')[1] || "").split("</table>")[0];
  for (const label of ["Note1", "Note2", "Note3", "Note4"]) {
    assert.match(roster, new RegExp(`>${label}<`));
  }
  for (const label of ["Série", "Ext\\\\.", "LV2", "Nat"]) {
    assert.doesNotMatch(roster, new RegExp(`>${label}<`));
  }
  assert.match(roster, /<td className="col-series"><\\/td>/);
  assert.match(roster, /<td className="col-board"><\\/td>/);
  assert.match(roster, /<td className="col-lv2"><\\/td>/);
  assert.match(roster, /<td className="col-nat"><\\/td>/);
});'''
new_test = '''test("printed roster groups four blank note columns and keeps contextual school heading", () => {
  const source = read("src/app/admin/classes/liste/[id]/page.tsx");
  const roster = (source.split('<table className="roster-table">')[1] || "").split("</table>")[0];
  for (const label of ["Note1", "Note2", "Note3", "Note4"]) {
    assert.match(roster, new RegExp(`>${label}<`));
  }
  assert.match(
    roster,
    /Note1<\\/th>\\s*<th[^>]*>Note2<\\/th>\\s*<th[^>]*>Note3<\\/th>\\s*<th[^>]*>Note4<\\/th>/s,
  );
  for (const label of ["Série", "Ext\\\\.", "LV2", "Nat"]) {
    assert.doesNotMatch(roster, new RegExp(`>${label}<`));
  }
  assert.match(source, /classListHeadRoleLabel/);
  assert.match(source, /return "Directeur des études"/);
  assert.match(source, /class-list-watermark/);
  assert.match(source, /opacity: 0\\.12/);
  assert.match(source, /opacity: 0\\.14 !important/);
});'''
text = replace_once(text, old_test, new_test, "roster regression test")

old_conflict_assertions = '''  assert.match(page, /visibleOccupancyForCell/);
  assert.match(page, /conflictMessagesForClass/);
  assert.match(page, /Conflit signalé — enregistrement autorisé/);
  assert.match(page, /créneaux déjà occupés de cette classe/);'''
new_conflict_assertions = '''  assert.match(page, /visibleOccupancyForCell/);
  assert.match(page, /conflictMessagesForClass/);
  assert.match(page, /conflictStatusLabel/);
  assert.match(page, /Matière présente :/);
  assert.match(page, /Professeur déjà présent :/);
  assert.doesNotMatch(page, /Conflit signalé/);
  assert.match(page, /créneaux déjà occupés de cette classe/);'''
text = replace_once(
    text,
    old_conflict_assertions,
    new_conflict_assertions,
    "timetable wording regression test",
)
save(path, text)


# Remove the one-shot patch machinery from the final feature commit.
Path("scripts/apply-roster-timetable-followup.py").unlink(missing_ok=True)
Path(".github/workflows/apply-roster-timetable-followup.yml").unlink(missing_ok=True)

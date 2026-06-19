const fs = require('fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}
function write(path, content) {
  fs.writeFileSync(path, content, 'utf8');
}
function replaceOnce(content, oldText, newText, label) {
  const count = content.split(oldText).length - 1;
  if (count !== 1) {
    throw new Error(`${label}: bloc attendu introuvable ou multiple (${count}).`);
  }
  return content.replace(oldText, newText);
}

const paymentsPath = 'src/app/admin/finance/payments/page.tsx';
let payments = read(paymentsPath);

payments = replaceOnce(
  payments,
`async function createStudentAndEnroll({
  institutionId,
  classId,
  firstName,
  lastName,
  matricule,
}: {
  institutionId: string;
  classId: string;
  firstName: string;
  lastName: string;
  matricule: string | null;
}) {`,
`async function createStudentAndEnroll({
  institutionId,
  userId,
  classId,
  firstName,
  lastName,
  matricule,
}: {
  institutionId: string;
  userId: string;
  classId: string;
  firstName: string;
  lastName: string;
  matricule: string | null;
}) {`,
  'payments signature createStudentAndEnroll'
);

payments = replaceOnce(
  payments,
`  if (enrollErr) throw new Error(enrollErr.message);

  return created.id as string;
}`,
`  if (enrollErr) throw new Error(enrollErr.message);

  // Important : on ne change pas la logique d'encaissement de Mon Cahier.
  // Après l'inscription minimale, on crée simplement les situations ouvertes
  // à partir des barèmes déjà définis pour la classe, comme le fait la
  // régularisation financière.
  await ensureChargesForStudent(
    institutionId,
    userId,
    created.id as string,
    classId,
  );

  return created.id as string;
}`,
  'payments génération frais après inscription'
);

payments = replaceOnce(
  payments,
`    studentId = await createStudentAndEnroll({
      institutionId,
      classId,
      firstName,
      lastName,
      matricule,
    });`,
`    studentId = await createStudentAndEnroll({
      institutionId,
      userId,
      classId,
      firstName,
      lastName,
      matricule,
    });`,
  'payments appel createStudentAndEnroll'
);

write(paymentsPath, payments);

const rosterPath = 'src/app/api/admin/classes/[id]/roster/route.ts';
let roster = read(rosterPath);

const helper = `
async function getAcademicYearIdForFinance(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string,
  academicYear: string | null,
) {
  if (!academicYear) return null;

  const { data, error } = await srv
    .from("academic_years")
    .select("id")
    .eq("institution_id", institutionId)
    .eq("code", academicYear)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data?.id ? String(data.id) : null;
}

async function ensureFinanceChargesForStudent(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string,
  userId: string,
  studentId: string,
  classId: string,
) {
  const { data: classRow, error: classErr } = await srv
    .from("classes")
    .select("id,label,level,academic_year,institution_id")
    .eq("id", classId)
    .eq("institution_id", institutionId)
    .maybeSingle();

  if (classErr) throw new Error(classErr.message);
  if (!classRow) throw new Error("Classe introuvable.");

  const { data: schedules, error: scheduleErr } = await srv
    .schema("finance")
    .from("fee_schedules")
    .select("id,school_id,academic_year,class_id,fee_category_id,label,amount,due_date,is_active,notes")
    .eq("school_id", institutionId)
    .eq("class_id", classId)
    .eq("is_active", true);

  if (scheduleErr) throw new Error(scheduleErr.message);

  const scheduleRows = Array.isArray(schedules) ? schedules : [];
  if (scheduleRows.length === 0) return 0;

  const scheduleIds = scheduleRows.map((row: any) => String(row.id)).filter(Boolean);

  const { data: existingCharges, error: existingErr } = await srv
    .schema("finance")
    .from("student_charges")
    .select("fee_schedule_id")
    .eq("school_id", institutionId)
    .eq("student_id", studentId)
    .eq("class_id", classId)
    .in("fee_schedule_id", scheduleIds);

  if (existingErr) throw new Error(existingErr.message);

  const existing = new Set(
    (existingCharges || [])
      .map((row: any) => String(row.fee_schedule_id || ""))
      .filter(Boolean),
  );

  const academicYear = String((classRow as any).academic_year || "").trim() || null;
  const academicYearId = await getAcademicYearIdForFinance(
    srv,
    institutionId,
    academicYear,
  );
  const today = new Date().toISOString().slice(0, 10);
  const nowIso = new Date().toISOString();

  const rowsToInsert = scheduleRows
    .filter((schedule: any) => !existing.has(String(schedule.id)))
    .map((schedule: any) => ({
      school_id: institutionId,
      academic_year_id: academicYearId,
      academic_year: schedule.academic_year || academicYear,
      student_id: studentId,
      class_id: classId,
      fee_schedule_id: schedule.id,
      fee_category_id: schedule.fee_category_id,
      label: schedule.label,
      base_amount: Number(schedule.amount || 0),
      due_date: schedule.due_date || null,
      charge_date: today,
      status: "pending",
      notes:
        schedule.notes ||
        "Situation créée automatiquement depuis " + schedule.label,
      created_by: userId,
      created_at: nowIso,
      updated_at: nowIso,
    }));

  if (rowsToInsert.length === 0) return 0;

  const { error: insertErr } = await srv
    .schema("finance")
    .from("student_charges")
    .insert(rowsToInsert as any[]);

  if (insertErr) throw new Error(insertErr.message);
  return rowsToInsert.length;
}
`;

if (!roster.includes('async function ensureFinanceChargesForStudent(')) {
  roster = roster.replace('\nexport async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {', `${helper}\nexport async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {`);
}

roster = replaceOnce(
  roster,
`  if (enrollErr) return NextResponse.json({ error: enrollErr.message }, { status: 400 });

  return NextResponse.json({ ok: true, student_id: created.id });`,
`  if (enrollErr) return NextResponse.json({ error: enrollErr.message }, { status: 400 });

  let chargesCreated = 0;
  let financeWarning: string | null = null;
  try {
    chargesCreated = await ensureFinanceChargesForStudent(
      srv,
      institutionId,
      ctx.user.id,
      String(created.id),
      classId,
    );
  } catch (error) {
    financeWarning =
      error instanceof Error ? error.message : "Génération automatique des frais impossible.";
  }

  return NextResponse.json({
    ok: true,
    student_id: created.id,
    charges_created: chargesCreated,
    finance_warning: financeWarning,
  });`,
  'roster réponse POST après enrollment'
);

write(rosterPath, roster);
console.log('OK : inscription minimale + génération des situations financières depuis les barèmes existants.');

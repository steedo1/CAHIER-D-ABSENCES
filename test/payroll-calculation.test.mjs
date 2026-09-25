import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/lib/finance/payroll-values.ts', import.meta.url), 'utf8');
const payrollPageSource = fs.readFileSync(new URL('../src/app/admin/finance/payroll/page.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS}}).outputText;
const exports = {};
new Function('exports', compiled)(exports);
const {parsePayrollAmount, parsePayrollMinutes, payrollPayable, assignmentCoversDay, findPayrollSession, calculatePayrollSession} = exports;

test('missing parameters retain defaults, explicit zero remains a valid tolerance or rate', () => {
  for (const value of [undefined, null, '', '  ', 'invalid', -1]) {
    assert.equal(parsePayrollMinutes(value, 55), 55);
    assert.equal(parsePayrollAmount(value, 2000), 2000);
  }
  assert.equal(parsePayrollMinutes('0', 15), 0);
  assert.equal(parsePayrollAmount(0, 2000), 0);
  assert.equal(parsePayrollAmount('1500,50', 2000), 1500.5);
});

const closed = (late=0, observed=55) => ({ dateISO:'2026-06-01T08:00:00Z', real_minutes:55-late,
  actual_call_iso:'2026-06-01T08:00:00Z', ended_at:'2026-06-01T08:55:00Z', late_minutes:late, observed_minutes:observed });
const pay = (row, rate=2000) => calculatePayrollSession(row,55,55,rate,15,5);

test('closed session pays the cycle rate; lateness and early departure have separate tolerances', () => {
  assert.equal(pay(closed()).adjusted_amount,2000);
  assert.equal(pay(closed(),1500).adjusted_amount,1500);
  assert.equal(pay(closed(15,35)).lost_amount,0); // 15 late + 5 early, both tolerated
  assert.equal(pay(closed(20,35)).lost_amount,182);
  assert.equal(pay(closed(20,35)).adjusted_amount,1818);
  assert.equal(pay(closed(20,25)).lost_amount,364); // 5 late + 5 early above tolerance
  assert.equal(pay({...closed(0,40),real_minutes:10}).lost_amount,364); // explicit 0 late is not missing
});

test('payroll loss never exceeds the expected session duration', () => {
  const short = calculatePayrollSession(
    { ...closed(0, 1), real_minutes: 1, observed_minutes: 1, late_minutes: 4 },
    5,
    55,
    2000,
    0,
    0,
  );
  assert.equal(short.lost_minutes_after_tolerance, 4);
  assert.ok(short.lost_minutes_after_tolerance <= 5);
});

test('absent, unstarted, unclosed, or zero-duration sessions are unpaid', () => {
  for (const row of [null,{...closed(),actual_call_iso:null},{...closed(),ended_at:null},closed(0,0)]) {
    assert.equal(pay(row).adjusted_amount,0);
    assert.equal(pay(row).counted_for_pay,false);
    assert.equal(pay(row).lost_amount,0); // no second deduction for an unpaid absence
  }
  assert.equal(pay(closed(0,120)).actual_minutes,55);
});

const slot = {session_date:'2026-06-01',class_id:'class',subject_id:'math',period_id:'morning',start_time:'08:00:00'};
test('an afternoon call cannot pay the missed morning slot, even in the same class', () => {
  const rows=[{...closed(),dateISO:'2026-06-01T14:00:00Z',class_ids:['class'],subject_ids:['math']}];
  assert.equal(findPayrollSession(rows,new Set(),slot),null);
  assert.equal(findPayrollSession(rows,new Set(),{...slot,start_time:'14:00:00'}),rows[0]);
});

test('grouped-class sessions are consumed once; another discipline or date cannot match', () => {
  const row={...closed(),class_ids:['class','group'],subject_ids:['math']};
  const used=new Set();
  assert.equal(findPayrollSession([row],used,slot),row);
  assert.equal(findPayrollSession([row],used,{...slot,class_id:'group'}),null);
  assert.equal(findPayrollSession([row],new Set(),{...slot,subject_id:'physics'}),null);
  assert.equal(findPayrollSession([row],new Set(),{...slot,session_date:'2026-06-02'}),null);
  assert.throws(()=>findPayrollSession([row,{...row}],new Set(),slot),/Plusieurs appels/);
});

test('a grouped physical slot matches any of its linked classes but is consumed once', () => {
  const groupedSlot = {
    ...slot,
    class_ids: ['class', 'group'],
    subject_ids: ['math'],
  };
  const row = {
    ...closed(),
    class_id: 'group',
    class_ids: ['group'],
    subject_id: 'math',
    subject_ids: ['math'],
    period_id: 'morning',
  };
  const used = new Set();
  assert.equal(findPayrollSession([row], used, groupedSlot), row);
  assert.equal(findPayrollSession([row], used, groupedSlot), null);
});

test('payroll groups timetable assignments by teacher physical day and period', () => {
  assert.match(payrollPageSource, /const physicalSlots = new Map<string, ExpectedSlot>\(\)/);
  assert.match(payrollPageSource, /const physicalKey = `\$\{day\}\|\$\{periodId\}`/);
  assert.match(payrollPageSource, /existing\.class_ids\.push\(classId\)/);
  assert.match(payrollPageSource, /existing\.subject_ids\.push\(subjectId\)/);
  assert.match(payrollPageSource, /classes de cycles différents/);
});

test('assignments apply on each date, including both boundaries', () => {
  const assignment={start_date:'2026-06-10',end_date:'2026-06-20'};
  assert.equal(assignmentCoversDay(assignment,'2026-06-09'),false);
  assert.equal(assignmentCoversDay(assignment,'2026-06-10'),true);
  assert.equal(assignmentCoversDay(assignment,'2026-06-20'),true);
  assert.equal(assignmentCoversDay(assignment,'2026-06-21'),false);
});

test('legacy payable amounts and zero net pay render consistently with totals', () => {
  assert.equal(payrollPayable({gross_amount:2000,lost_amount:182,adjusted_amount:null}),1818);
  assert.equal(payrollPayable({gross_amount:2000,lost_amount:0,adjusted_amount:0}),0);
  assert.equal(payrollPayable({gross_amount:'2000',lost_amount:null}),2000);
});
import assert from "node:assert/strict";
import test from "node:test";
import {
  listDirectorClasses, directorStudentMembership,
  directorSubjectPermitted, directorClassPermitted,
} from "../src/lib/school-director-resource-scope";
import { parseSchoolCyclesSettings } from "../src/lib/school-cycles";

const F="11111111-1111-4111-8111-111111111111";
const A="22222222-2222-4222-8222-222222222222";
const U="33333333-3333-4333-8333-333333333333";
const S1="44444444-4444-4444-8444-444444444444";
const S2="55555555-5555-4555-8555-555555555555";
const M="66666666-6666-4666-8666-666666666666";
const OTHER="77777777-7777-4777-8777-777777777777";
const year="2026-2027";
const raw={
  school_cycles_v1: {
    version:1,enabled:true,enabledCycles:["primary"],
    classCycleById:{[F]:"primary",[A]:"primary",[U]:"primary"},
    teachingTracksByCycle:{primary:["french","arabic"]},
    subjectTracksByCycle:{primary:{[M]:["french"],[OTHER]:["arabic"]}},
  },
  school_student_programs_v1: {
    version:1,years:{[year]:{classes:{
      [F]:{tracks:["french"],students:{}},
      [A]:{tracks:["arabic"],students:{},linkedStudentIds:[S1]},
      [U]:{tracks:["french","arabic"],students:{[S2]:["arabic"]}},
    }}},
  },
};
const classes=[
  {id:F,label:"CP1 français",level:"CP1",academic_year:year},
  {id:A,label:"CP1 arabe",level:"CP1",academic_year:year},
  {id:U,label:"CE1 bilingue",level:"CE1",academic_year:year},
];
const enrolments=[
  {class_id:F,student_id:S1,end_date:null},
  {class_id:U,student_id:S2,end_date:null},
];

test("director classes are year, cycle and teaching scoped",()=>{
  const french=listDirectorClasses(raw,year,"french",classes);
  const arabic=listDirectorClasses(raw,year,"arabic",classes);
  assert.deepEqual(french.map(row=>row.id),[F,U]);
  assert.deepEqual(arabic.map(row=>row.id),[A,U]);
  assert.equal(directorClassPermitted(raw,year,"arabic",classes,F),false);
  assert.deepEqual(listDirectorClasses(raw,"2025-2026","french",classes),[]);
  assert.deepEqual(listDirectorClasses({},year,"french",classes),[]);
});

test("linked students are visible only in the authorized teaching, without second enrollment",()=>{
  const french=directorStudentMembership(raw,year,"french",classes,enrolments);
  const arabic=directorStudentMembership(raw,year,"arabic",classes,enrolments);
  assert.deepEqual(french.map(x=>[x.classId,x.studentId]),[[F,S1]]);
  assert.deepEqual(arabic.map(x=>[x.classId,x.studentId]).sort(),[[A,S1],[U,S2]].sort());
  assert.equal(enrolments.length,2);
  assert.equal(arabic.filter(x=>x.studentId===S1).length,1);
});

test("only explicit subject-to-track mappings authorize teaching personnel and evaluations",()=>{
  const settings=parseSchoolCyclesSettings(raw);
  assert.equal(directorSubjectPermitted(settings,"primary","french",M),true);
  assert.equal(directorSubjectPermitted(settings,"primary","arabic",M),false);
  assert.equal(directorSubjectPermitted(settings,"primary","arabic",OTHER),true);
  assert.equal(directorSubjectPermitted(settings,"primary","arabic","unknown"),false);
  assert.equal(directorSubjectPermitted(settings,"secondary","arabic",OTHER),false);
  assert.equal(directorSubjectPermitted(parseSchoolCyclesSettings({}),"primary","french",M),false);
});

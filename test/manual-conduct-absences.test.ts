import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateAssiduity, DEFAULT_ASSIDUITY_RULES, manualAbsenceReason, manualHoursForRange, parseAbsenceHours, parseManualAbsenceReason, previewManualConduct } from "../src/lib/manual-conduct-absences";
test("Heures : zéro, décimales françaises ; vides, notes et valeurs invalides refusées", () => {
  for (const [value, expected] of [[0,0],["0",0],["2,5",2.5],["4.25",4.25]] as const) assert.equal(parseAbsenceHours(value), expected);
  for (const value of ["", " ", -1, "abc", "0x10", true, null, NaN, Infinity, 5001, "2,555"]) assert.equal(parseAbsenceHours(value), null);
});
test("Barème courant : 0h=20, 4h=18, seuil 10h=14 sans modifier la note à la main", () => {
  assert.equal(calculateAssiduity(0,6,DEFAULT_ASSIDUITY_RULES)+14,20);
  assert.equal(calculateAssiduity(4,6,DEFAULT_ASSIDUITY_RULES)+14,18);
  assert.equal(calculateAssiduity(10,6,DEFAULT_ASSIDUITY_RULES)+14,14);
  assert.equal(calculateAssiduity(100,6,DEFAULT_ASSIDUITY_RULES)+14,14);
  assert.equal(calculateAssiduity(4,6,{...DEFAULT_ASSIDUITY_RULES,penalty_per_hour:1})+14,16);
});
test("La source conserve les heures et le trimestre ; une correction ordinaire reste distincte", () => {
  const source={hours:0,periodId:"T1-id"};assert.deepEqual(parseManualAbsenceReason(manualAbsenceReason(source)),source);
  assert.equal(parseManualAbsenceReason("Correction administrative"),null);
  assert.equal(parseManualAbsenceReason("MC_MANUAL_ABSENCES_V1:invalid"),null);
});
test("La conduite composite et les sanctions continuent de s’appliquer", () => {
  const maxes={assiduite:6,tenue:3,moralite:4,discipline:7};
  const item={student_id:"s",full_name:"ÉLÈVE Test",total:20,breakdown:maxes};
  assert.equal(previewManualConduct(item,4,maxes,DEFAULT_ASSIDUITY_RULES),18);
  assert.equal(previewManualConduct({...item,conduct_has_council:true,conduct_council_cap:5},4,maxes,DEFAULT_ASSIDUITY_RULES),5);
  const composite={...item,conduct_policy_mode:"conduct_plus_subjects",conduct_policy_components:[{kind:"classic_conduct",weight:1,avg20:20,included:true},{kind:"subject",weight:1,avg20:12,included:true}]};
  assert.equal(previewManualConduct(composite,4,maxes,DEFAULT_ASSIDUITY_RULES),15);
});
test("Les totaux du trimestre ne se doublent pas lors d’un transfert ; lecture courante avant la fin du trimestre", () => {
  const reason=manualAbsenceReason({hours:4,periodId:"period1"});
  const row={reason,from_date:"2026-09-14",to_date:"2026-12-04",updated_at:"2026-10-14T12:00:00Z"};
  assert.equal(manualHoursForRange([row],"2026-09-14","2026-10-14"),4);
  assert.equal(manualHoursForRange([row],"2026-10-01","2026-10-14"),null,"un total trimestriel ne décrit pas un mois partiel");
  assert.equal(manualHoursForRange([{...row,from_date:"2026-12-07",to_date:"2027-03-12"}],"2026-09-14","2026-10-14"),null,"un trimestre futur n’entre pas dans le trimestre courant");
  assert.equal(manualHoursForRange([row,{...row,reason:manualAbsenceReason({hours:5,periodId:"period1"}),updated_at:"2026-10-14T13:00:00Z"}],"2026-09-14","2026-12-04"),5);
});

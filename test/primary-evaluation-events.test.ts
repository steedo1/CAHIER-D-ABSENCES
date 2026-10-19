import test from "node:test";
import assert from "node:assert/strict";
import {
  calculatePrimaryAnnualAverage,
  isValidSchoolDate, primaryAnnualEligible,
  primaryEventForClass, primaryEventIdFromTitle, primaryEventTitle,
  readPrimaryEvents, validatePrimaryEvents, PRIMARY_EVENTS_SETTINGS_KEY,
} from "../src/lib/grades/primary-evaluation-events";

const year = "2026-2027";
const comp = {
  id:"123e4567-e89b-42d3-a456-426614174000", kind:"composition" as const,
  label:"Composition de décembre", date:"2026-12-10", levels:["CP1","CM1"] as ("CP1"|"CM1")[], bulletin:true,
};
const passage = {
  id:"123e4567-e89b-42d3-a456-426614174001", kind:"passage" as const,
  label:"Composition de passage", date:"2027-06-03", levels:["CP1","CM1"] as ("CP1"|"CM1")[], bulletin:true,
};
test("les dates sont ponctuelles et bornées par année scolaire", () => {
  assert.equal(isValidSchoolDate("2026-12-10",year),true);
  assert.equal(isValidSchoolDate("2027-06-03",year),true);
  assert.equal(isValidSchoolDate("2027-02-30",year),false);
  assert.equal(isValidSchoolDate("2028-06-03",year),false);
});
test("une même évaluation interne peut revenir avant chaque composition", () => {
  const common = { kind:"interne" as const,label:"Évaluation de niveau",levels:["CP1"] as ["CP1"],bulletin:true };
  const events=validatePrimaryEvents([
    { ...common,id:"123e4567-e89b-42d3-a456-426614174010",date:"2026-12-03" },
    { ...common,id:"123e4567-e89b-42d3-a456-426614174011",date:"2027-01-28" },
  ],year);
  assert.equal(events.length,2);
  assert.equal(primaryAnnualEligible(events[0].kind),false);
  assert.equal(primaryEventForClass(events,events[0].id,"CP1")?.date,"2026-12-03");
});
test("la composition de passage n’est jamais proposée en CM2", () => {
  assert.throws(()=>validatePrimaryEvents([{ ...passage, levels:["CM2"] }],year));
  assert.equal(primaryEventForClass([passage],passage.id,"CM2"),null);
});
test("les examens blancs sont uniquement au CM2", () => {
  assert.throws(()=>validatePrimaryEvents([{
    ...comp,kind:"examen_blanc",levels:["CM1"],
  }],year));
});
test("les identifiants conservés en base sont non ambigus", () => {
  assert.equal(primaryEventIdFromTitle(primaryEventTitle(comp.id)),comp.id);
  assert.equal(primaryEventIdFromTitle("Composition"),null);
});
test("aucun devoir ou bilan interne dans la moyenne annuelle", () => {
  assert.equal(primaryAnnualEligible("composition"),true);
  assert.equal(primaryAnnualEligible("passage"),true);
  assert.equal(primaryAnnualEligible("interne"),false);
  assert.equal(primaryAnnualEligible("examen_blanc"),false);
  assert.equal(calculatePrimaryAnnualAverage([6,7,8],9),(7+2*9)/3);
  assert.equal(calculatePrimaryAnnualAverage([],9),null);
  assert.equal(calculatePrimaryAnnualAverage([6],Number.NaN),null);
});
test("aucune configuration primaire par défaut : l'administration décide", () => {
  assert.deepEqual(readPrimaryEvents({},year),[]);
  assert.deepEqual(readPrimaryEvents({
    [PRIMARY_EVENTS_SETTINGS_KEY]:{version:1,years:{[year]:[comp,passage]}},
  },year),[comp,passage]);
});

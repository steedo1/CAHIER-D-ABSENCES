import assert from "node:assert/strict";
import test from "node:test";

import {
  classMatchesEducationScope,
  type EducationScopedClass,
} from "../src/lib/education-scope";

const general: EducationScopedClass = {
  id: "general-6e-a",
  label: "6e A",
  level: "6e",
  education_type: null,
  formation_code: null,
  formation_level_code: null,
};

const capElevage: EducationScopedClass = {
  id: "cap-elevage-a",
  label: "CAP Élevage A",
  level: "CAP",
  education_type: "vocational_training",
  formation_code: "catalog:vocational_cap_elevage",
  formation_level_code: "1CAP ELEV",
};

const bepElevage: EducationScopedClass = {
  id: "bep-elevage-a",
  label: "BEP Élevage A",
  level: "BEP",
  education_type: "vocational_training",
  formation_code: "custom:local_1784826086189_elevage",
  formation_level_code: "1BEP ELEV",
};

test("le contexte historique NULL reste strictement secondaire général", () => {
  assert.equal(
    classMatchesEducationScope(general, {
      educationType: "general_secondary",
      formationCode: "",
      levelCode: "6e",
      classId: "",
    }),
    true,
  );
  assert.equal(
    classMatchesEducationScope(general, {
      educationType: "vocational_training",
      formationCode: "catalog:vocational_cap_elevage",
      levelCode: "1CAP ELEV",
      classId: "",
    }),
    false,
  );
});

test("CAP Élevage et BEP Élevage ne se mélangent jamais", () => {
  const classes = [general, capElevage, bepElevage];
  const capScope = {
    educationType: "vocational_training" as const,
    formationCode: "catalog:vocational_cap_elevage",
    levelCode: "1CAP ELEV",
    classId: "",
  };
  const bepScope = {
    educationType: "vocational_training" as const,
    formationCode: "custom:local_1784826086189_elevage",
    levelCode: "1BEP ELEV",
    classId: "",
  };

  assert.deepEqual(
    classes.filter((row) => classMatchesEducationScope(row, capScope)),
    [capElevage],
  );
  assert.deepEqual(
    classes.filter((row) => classMatchesEducationScope(row, bepScope)),
    [bepElevage],
  );
});

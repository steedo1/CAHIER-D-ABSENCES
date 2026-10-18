import assert from "node:assert/strict";
import test from "node:test";
import { offlineRoleForDirectorTeacher } from "../src/lib/auth/director-offline-role";

const school="school-1";
const teacher={role:"teacher",institution_id:school};
const director={role:"teaching_director",institution_id:school};

test("a nominated teacher keeps a teacher-only offline grant",()=>{
  assert.equal(offlineRoleForDirectorTeacher("teaching_director",[director,teacher],school),"teacher");
  assert.equal(offlineRoleForDirectorTeacher("teaching_director",[director],school),null);
  assert.equal(offlineRoleForDirectorTeacher("teaching_director",
    [director,{role:"teacher",institution_id:"other-school"}],school),null);
  assert.equal(offlineRoleForDirectorTeacher("teaching_director",
    [director,{role:"admin",institution_id:school}],school),null);
});
test("classic offline roles are unchanged and no director finance/admin offline grants exist",()=>{
  assert.equal(offlineRoleForDirectorTeacher("teacher",[teacher],school),"teacher");
  assert.equal(offlineRoleForDirectorTeacher("admin",[{role:"admin",institution_id:school}],school),"admin");
  assert.equal(offlineRoleForDirectorTeacher("class_device",[],school),"class_device");
  assert.equal(offlineRoleForDirectorTeacher("finance_manager",[],school),null);
});

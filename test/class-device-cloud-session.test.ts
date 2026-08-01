import assert from "node:assert/strict";
import { test } from "node:test";
import { classDeviceCloudSessionId } from "../src/lib/class-device-cloud-session";

const base = {
  institutionId: "school-a",
  classId: "class-a",
  actorProfileId: "device-a",
  operationId: "open-operation-0001",
};

test("le meme operation_id produit la meme seance Cloud", () => {
  const first = classDeviceCloudSessionId(base);
  const second = classDeviceCloudSessionId({ ...base });
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("deux classes ou deux ecoles ne partagent jamais un identifiant de seance", () => {
  const ids = new Set([
    classDeviceCloudSessionId(base),
    classDeviceCloudSessionId({ ...base, classId: "class-b" }),
    classDeviceCloudSessionId({ ...base, institutionId: "school-b" }),
  ]);
  assert.equal(ids.size, 3);
});

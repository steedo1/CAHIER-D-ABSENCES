import { createHash } from "node:crypto";

function uuidFromHex(hex: string) {
  const chars = hex.slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = ((Number.parseInt(chars[16] || "0", 16) & 0x3) | 0x8).toString(16);
  const value = chars.join("");
  return [
    value.slice(0, 8),
    value.slice(8, 12),
    value.slice(12, 16),
    value.slice(16, 20),
    value.slice(20, 32),
  ].join("-");
}

export function classDeviceCloudSessionId(input: {
  institutionId: string;
  classId: string;
  actorProfileId: string;
  operationId: string;
}) {
  const scope = [
    "class-device-session-v1",
    input.institutionId,
    input.classId,
    input.actorProfileId,
    input.operationId,
  ].map((value) => String(value || "").trim());
  if (scope.some((value) => !value)) {
    throw new Error("class_device_session_scope_incomplete");
  }
  return uuidFromHex(createHash("sha256").update(scope.join("\u001f")).digest("hex"));
}

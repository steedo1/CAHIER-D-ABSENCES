import { createHash } from "node:crypto";

/** Context fingerprint, not an authorization token. Every request is reauthorized. */
export function conversationContext(userId: string, institutionId: string) {
  return createHash("sha256").update(JSON.stringify([userId, institutionId])).digest("hex");
}

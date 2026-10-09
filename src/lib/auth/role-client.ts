"use client";

// Share only concurrent requests for the same browser actor. No role TTL and
// no persisted authorization result: each later lookup still reaches the API.
const pending = new Map<string, Promise<Response>>();
export async function fetchAuthRole(actorId: string): Promise<Response> {
  const running = pending.get(actorId);
  if (running) return (await running).clone();
  const task = fetch("/api/auth/role", { cache: "no-store", credentials: "include" })
    .then(async (response) => new Response(await response.arrayBuffer(), {
      status: response.status, statusText: response.statusText, headers: response.headers,
    }));
  pending.set(actorId, task);
  try { return (await task).clone(); }
  finally { if (pending.get(actorId) === task) pending.delete(actorId); }
}

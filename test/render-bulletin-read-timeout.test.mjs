import assert from "node:assert/strict";
import test from "node:test";
import { offlineGetJson } from "../src/lib/offline.ts";

test("Render bulletin: a valid response after eight seconds is not discarded", { timeout: 15000 }, async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  try {
    globalThis.fetch = async () => {
      attempts += 1;
      await new Promise(resolve => setTimeout(resolve, 8000));
      return new Response(JSON.stringify({ ok: true, specialized: { documents: [] } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const result = await offlineGetJson(
      "/api/admin/grades/bulletin?class_id=fixture&academic_year=2026-2027",
      "test:render:bulletin:slow-success",
    );
    assert.equal(result.ok, true);
    assert.equal(attempts, 1, "never replay a slow read automatically");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Render bulletin: a forbidden response is never disguised as offline", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
    await assert.rejects(
      offlineGetJson("/api/admin/grades/bulletin?class_id=forbidden", "test:render:bulletin:denied"),
      error => error instanceof Error && error.message === "forbidden",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

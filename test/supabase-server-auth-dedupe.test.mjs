import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/supabase-server.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;

test("la vérification de setSession sert aux contrôles suivants du même client", async () => {
  const savedUrl = process.env.SUPABASE_URL;
  const savedKey = process.env.SUPABASE_ANON_KEY;
  process.env.SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_ANON_KEY = "test-anon";
  let getUserCalls = 0;
  let validationCalls = 0;
  const user = { id: "authenticated-user" };
  const client = {
    auth: {
      async setSession() { validationCalls++; return { data: { user }, error: null }; },
      async getUser() { getUserCalls++; return { data: { user }, error: null }; },
    },
  };
  const cookies = new Map([
    ["sb-access-token", "test-access"],
    ["sb-refresh-token", "test-refresh"],
  ]);
  const authModule = { exports: {} };
  try {
    new Function("require", "module", "exports", compiled)((name) => {
      if (name === "next/headers") return { cookies: async () => ({ get: (key) => ({ value: cookies.get(key) }) }) };
      if (name === "@supabase/ssr") return { createServerClient: () => client };
      throw new Error(`Unexpected import: ${name}`);
    }, authModule, authModule.exports);
    const server = await authModule.exports.getSupabaseServerClient();
    const verified = await authModule.exports.getVerifiedServerUser(server);
    assert.equal(verified.data.user.id, user.id);
    assert.equal(validationCalls, 1);
    assert.equal(getUserCalls, 0);
  } finally {
    if (savedUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = savedUrl;
    if (savedKey === undefined) delete process.env.SUPABASE_ANON_KEY;
    else process.env.SUPABASE_ANON_KEY = savedKey;
  }
});

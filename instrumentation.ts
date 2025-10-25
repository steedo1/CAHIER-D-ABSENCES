// instrumentation.ts
/* eslint-disable no-console */

export async function register() {
  // no-op en prod
  if (process.env.NODE_ENV === "production") return;

  const g: any = globalThis as any;
  const p: any = g.process;

  // --- 1) Journalisation des erreurs globales ---
  // Node (process.on) si disponible
  if (p && typeof p["on"] === "function") {
    p["on"]("unhandledRejection", (reason: any) => {
      const msg = reason?.stack || reason?.message || String(reason);
      console.error("\n[INSTRUMENT] unhandledRejection →", msg, "\n");
    });
    p["on"]("uncaughtException", (err: any) => {
      console.error("\n[INSTRUMENT] uncaughtException →", err?.stack || err?.message, "\n");
    });
  }

  // Edge/Web runtime (addEventListener)
  if (typeof g.addEventListener === "function") {
    g.addEventListener("unhandledrejection", (e: any) => {
      const reason = e?.reason ?? e;
      console.error(
        "\n[INSTRUMENT] (edge) unhandledrejection →",
        reason?.stack || reason?.message || String(reason),
        "\n"
      );
    });
    g.addEventListener("error", (e: any) => {
      const err = e?.error ?? e?.message ?? e;
      console.error("\n[INSTRUMENT] (edge) error →", err?.stack || err, "\n");
    });
  }

  // --- 2) Garde-fou JSON.parse en DEV (Node & Edge) ---
  const origParse: typeof JSON.parse = JSON.parse.bind(JSON);

  // @ts-ignore – override volontaire pour instrumentation dev
  JSON.parse = function (input: any, reviver?: any) {
    try {
      return origParse(input, reviver);
    } catch (e: any) {
      try {
        const s = typeof input === "string" ? input : String(input);
        const peek = s.slice(0, 160);
        const hex = Array.from(peek)
          .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
          .join(" ");
        console.error("[INSTRUMENT] JSON.parse FAILED");
        console.error("  peek:", JSON.stringify(peek));
        console.error("  hex :", hex);
        console.error("  stack:", e?.stack || e?.message);
      } catch {
        // ignore logging failure
      }
      throw e;
    }
  };

  console.log("[INSTRUMENT] Dev JSON.parse guard installed (Node/Edge-safe)");
}

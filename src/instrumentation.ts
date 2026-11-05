// With src/app, Next discovers instrumentation beside app in src/.
// Keep the existing development diagnostics in their own module.
export async function register() {
  if (process.env.NODE_ENV === "production") {
    if (process.env.NEXT_RUNTIME === "nodejs") {
      const { configureImageMemory } = await import("./lib/runtime-image-memory");
      console.info("[runtime-image-memory] " + JSON.stringify(configureImageMemory()));
      const { startMemoryTelemetry } = await import("./lib/runtime-memory");
      startMemoryTelemetry();
    }
    return;
  }
  const { register: registerDevelopment } = await import("../instrumentation");
  await registerDevelopment();
}

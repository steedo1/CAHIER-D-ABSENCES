import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";

test("browser compresses JPG/JPEG/PNG, preserves basename, proportions and small images", { timeout: 60000 }, async () => {
  const bundled = await build({ entryPoints: ["src/lib/student-photo-compression.ts"], bundle: true, write: false, format: "iife", globalName: "PhotoCompression" });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CLASS_LIST_CHROMIUM_EXECUTABLE || undefined, args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-zygote"] });
  try {
    const page = await browser.newPage();
    await page.addScriptTag({ content: bundled.outputFiles[0].text });
    const metrics = await page.evaluate(async () => {
      const canvas = document.createElement("canvas"); canvas.width = 2400; canvas.height = 3200;
      const ctx = canvas.getContext("2d");
      const gradient = ctx.createLinearGradient(0, 0, 2400, 3200);
      gradient.addColorStop(0, "#eee"); gradient.addColorStop(1, "#543");
      ctx.fillStyle = gradient; ctx.fillRect(0, 0, 2400, 3200);
      ctx.fillStyle = "white"; ctx.font = "120px sans-serif"; ctx.fillText("Photo élève", 300, 1500);
      const results = [];
      for (const [type, extension] of [["image/jpeg", "JPG"], ["image/jpeg", "jpeg"], ["image/png", "PNG"]]) {
        const blob = await new Promise(resolve => canvas.toBlob(resolve, type, 1));
        const source = new File([blob], `EPC260001.${extension}`, { type });
        const result = await PhotoCompression.compressStudentPhoto(source);
        const image = await createImageBitmap(result);
        results.push({ input: source.size, output: result.size, width: image.width, height: image.height, name: result.name, type: result.type });
        image.close();
      }
      canvas.width = 200; canvas.height = 300;
      const small = new File([await new Promise(resolve => canvas.toBlob(resolve, "image/png"))], "nom.png", { type: "image/png" });
      const unchanged = await PhotoCompression.compressStudentPhoto(small) === small;
      const invalid = new File(["broken"], "bad.jpg", { type: "image/jpeg" });
      let rejected = false;
      try { await PhotoCompression.compressStudentPhoto(invalid); } catch { rejected = true; }
      // Exercise the decoder fallback used on older Android browsers.
      window.createImageBitmap = undefined;
      const fallback = await PhotoCompression.compressStudentPhoto(small);
      return { results, unchanged, rejected, fallback: fallback === small };
    });
    for (const result of metrics.results) {
      assert.ok(result.output <= 200 * 1024);
      assert.ok(result.output < result.input);
      assert.equal(result.width, 768); assert.equal(result.height, 1024);
      assert.equal(result.name, "EPC260001.jpg"); assert.equal(result.type, "image/jpeg");
    }
    assert.equal(metrics.unchanged, true); assert.equal(metrics.rejected, true); assert.equal(metrics.fallback, true);
    console.log("Synthetic photo measurements (bytes):", JSON.stringify(metrics.results));
  } finally { await browser.close(); }
});

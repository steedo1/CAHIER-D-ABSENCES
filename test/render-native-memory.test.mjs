import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import sharp from "sharp";
import { configureImageMemory } from "../src/lib/runtime-image-memory.ts";

test("native image budget preserves valid images under repeated concurrent transformations", async () => {
  const originalCache = sharp.cache();
  const originalConcurrency = sharp.concurrency();
  try {
    configureImageMemory();
    configureImageMemory();
    assert.equal(sharp.cache().memory.max, 8);
    assert.equal(sharp.cache().files.max, 0);
    assert.equal(sharp.cache().items.max, 32);
    assert.equal(sharp.concurrency(), 1);
    const input = await sharp({ create: { width: 1600, height: 900, channels: 4,
      background: { r: 23, g: 151, b: 88, alpha: 1 } } }).png().toBuffer();
    for (let batch = 0; batch < 4; batch++) {
      await Promise.all(Array.from({ length: 8 }, async () => {
        const output = await sharp(input).resize(160, 90).webp().toBuffer();
        const decoded = await sharp(output).metadata();
        assert.equal(decoded.width, 160);
        assert.equal(decoded.height, 90);
        assert.equal(decoded.format, "webp");
      }));
    }
    assert.ok(sharp.cache().items.current <= 32);
  } finally {
    sharp.cache({ memory: originalCache.memory.max, files: originalCache.files.max, items: originalCache.items.max });
    sharp.concurrency(originalConcurrency);
  }
});

test("smaller young generation leaves the existing 288 MiB old-space budget intact", () => {
  const result = spawnSync(process.execPath, ["--max-old-space-size=288", "--max-semi-space-size=4", "-e",
    'console.log(require("node:v8").getHeapStatistics().heap_size_limit)'], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(Number(result.stdout), 300 * 1024 * 1024);
});

test("Next build includes the src instrumentation entry", { skip: !process.env.MON_CAHIER_VERIFY_BUILT_INSTRUMENTATION }, () => {
  const built = readFileSync(".next/server/instrumentation.js", "utf8");
  assert.match(built, /register/);
});

import sharp from "sharp";

/** libvips buffers sit outside V8's --max-old-space-size limit. Limit its
 * reusable operation cache and threads without changing images or HTTP caches.
 * These settings apply to both Next's optimizer and school signature images. */
export function configureImageMemory() {
  sharp.cache({ memory: 8, files: 0, items: 32 });
  sharp.concurrency(1);
  return { cacheMB: sharp.cache().memory.max, concurrency: sharp.concurrency() };
}

// Generate versioned, lightweight copies; keep originals for cached old pages.
// Bump .v2 URLs and next.config.mjs if the source artwork changes after release.
import sharp from "sharp";
import { stat } from "node:fs/promises";

let originalBytes = 0, optimizedBytes = 0;
async function record(source, destination) {
  const before = (await stat(source)).size, after = (await stat(destination)).size;
  originalBytes += before; optimizedBytes += after;
  console.log(`${source}: ${before} → ${after} bytes`);
}
for (const name of ["admin", "nexa-digital-logo", "accueil", "home/hero-notes", "home/hero-textes", "home/hero-communication", "home/hero-finance"]) {
  const source = `public/${name}.png`, destination = `public/${name}.v2.webp`;
  await sharp(source).webp({ quality: 82, effort: 6 }).toFile(destination);
  await record(source, destination);
}
for (const size of [192, 512]) {
  const source = `public/icons/icon-${size}.png`, destination = `public/icons/icon-${size}.v2.png`;
  await sharp(source).png({ palette: true, colours: 128, effort: 10 }).toFile(destination);
  await record(source, destination);
}
await sharp("public/favicon.png").resize(64, 64).png({ palette: true, colours: 128, effort: 10 }).toFile("public/favicon.v2.png");
await record("public/favicon.png", "public/favicon.v2.png");
console.log({ originalBytes, optimizedBytes, reductionPercent: (100 * (1 - optimizedBytes / originalBytes)).toFixed(2) });

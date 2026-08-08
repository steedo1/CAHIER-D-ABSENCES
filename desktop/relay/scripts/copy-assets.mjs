import { cpSync, copyFileSync, mkdirSync } from "node:fs";

function copyDirectory(source, destination) {
  mkdirSync(destination, { recursive: true });
  cpSync(source, destination, { recursive: true });
}

function copyFile(source, destination) {
  mkdirSync(new URL("./", destination), { recursive: true });
  copyFileSync(source, destination);
}

copyDirectory(
  new URL("../migrations/", import.meta.url),
  new URL("../dist/migrations/", import.meta.url),
);
copyDirectory(
  new URL("../protocol/", import.meta.url),
  new URL("../dist/protocol/", import.meta.url),
);
copyDirectory(
  new URL("../windows/", import.meta.url),
  new URL("../dist/windows/", import.meta.url),
);

for (const script of [
  "assert-release-safe.mjs",
  "create-release-manifest.mjs",
  "release-safety.mjs",
]) {
  copyFile(
    new URL(`../scripts/${script}`, import.meta.url),
    new URL(`../dist/scripts/${script}`, import.meta.url),
  );
}

for (const file of [".gitignore", "package.json"]) {
  copyFile(
    new URL(`../${file}`, import.meta.url),
    new URL(`../dist/${file}`, import.meta.url),
  );
}

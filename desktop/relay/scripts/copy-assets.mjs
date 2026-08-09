import { cpSync, mkdirSync } from "node:fs";

mkdirSync(new URL("../dist/migrations/", import.meta.url), { recursive: true });
mkdirSync(new URL("../dist/protocol/", import.meta.url), { recursive: true });
cpSync(
  new URL("../migrations/", import.meta.url),
  new URL("../dist/migrations/", import.meta.url),
  { recursive: true },
);
cpSync(
  new URL("../protocol/", import.meta.url),
  new URL("../dist/protocol/", import.meta.url),
  { recursive: true },
);

mkdirSync(new URL("../dist/windows/", import.meta.url), { recursive: true });
cpSync(
  new URL("../windows/", import.meta.url),
  new URL("../dist/windows/", import.meta.url),
  { recursive: true },
);

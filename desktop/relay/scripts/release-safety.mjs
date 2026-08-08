import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const FORBIDDEN_SEGMENTS = new Set([
  ".git",
  "backups",
  "data",
  "node_modules",
]);

const FORBIDDEN_EXACT_NAMES = new Set([
  "config.json",
  "credentials.json",
]);

function normalizeRelative(value) {
  return String(value || "")
    .replaceAll("\\", "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "");
}

export function releasePathViolation(relativePath) {
  const normalized = normalizeRelative(relativePath);
  if (!normalized || normalized === ".") return null;

  const parts = normalized.split("/").filter(Boolean);
  const loweredParts = parts.map((part) => part.toLowerCase());
  const forbiddenSegment = loweredParts.find((part) => FORBIDDEN_SEGMENTS.has(part));
  if (forbiddenSegment) return `forbidden_segment:${forbiddenSegment}`;

  const basename = loweredParts.at(-1) || "";
  if (FORBIDDEN_EXACT_NAMES.has(basename)) {
    return `forbidden_file:${basename}`;
  }
  if (basename === ".env" || (basename.startsWith(".env.") && basename !== ".env.example")) {
    return "forbidden_secret_environment_file";
  }
  if (
    /\.(?:db|sqlite|sqlite3)(?:-(?:wal|shm))?$/i.test(basename) ||
    /\.(?:log|p12|pfx|pem|key|token)$/i.test(basename)
  ) {
    return `forbidden_sensitive_extension:${path.extname(basename).toLowerCase()}`;
  }
  if (/(?:\.db|\.sqlite|\.sqlite3)-(?:wal|shm)$/i.test(basename)) {
    return "forbidden_sqlite_sidecar";
  }
  return null;
}

async function walk(root, current = "") {
  const absolute = path.join(root, current);
  const entries = await fs.readdir(absolute, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = normalizeRelative(path.join(current, entry.name));
    const violation = releasePathViolation(relative);
    if (violation) {
      files.push({ path: relative, violation, kind: entry.isDirectory() ? "directory" : "file" });
      if (entry.isDirectory()) continue;
    }
    if (entry.isSymbolicLink()) {
      files.push({ path: relative, violation: "symbolic_link_not_allowed", kind: "symlink" });
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...(await walk(root, relative)));
    } else if (entry.isFile()) {
      files.push({ path: relative, violation: null, kind: "file" });
    }
  }
  return files;
}

export async function scanReleaseTree(root) {
  const absoluteRoot = path.resolve(root);
  const entries = await walk(absoluteRoot);
  return {
    root: absoluteRoot,
    entries,
    files: entries.filter((entry) => entry.kind === "file" && !entry.violation),
    violations: entries.filter((entry) => entry.violation),
  };
}

export async function sha256File(filePath) {
  const bytes = await fs.readFile(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

export async function createReleaseManifest(root, metadata = {}) {
  const scan = await scanReleaseTree(root);
  if (scan.violations.length) {
    const error = new Error("release_tree_contains_sensitive_files");
    error.violations = scan.violations;
    throw error;
  }
  const files = [];
  for (const entry of scan.files) {
    if (entry.path === "release-manifest.json") continue;
    const absolute = path.join(scan.root, ...entry.path.split("/"));
    const stat = await fs.stat(absolute);
    files.push({
      path: entry.path,
      size: stat.size,
      sha256: await sha256File(absolute),
    });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return {
    manifest_version: 1,
    product: "mon-cahier-relay",
    ...metadata,
    files,
  };
}

function manifestFileRows(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("release_manifest_invalid");
  }
  if (manifest.manifest_version !== 1 || manifest.product !== "mon-cahier-relay") {
    throw new Error("release_manifest_contract_invalid");
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error("release_manifest_files_missing");
  }
  return manifest.files;
}

export async function verifyReleaseManifest(root, manifestPath) {
  const absoluteRoot = path.resolve(root);
  const absoluteManifest = path.resolve(manifestPath);
  const manifest = JSON.parse(await fs.readFile(absoluteManifest, "utf8"));
  const rows = manifestFileRows(manifest);
  const seen = new Set();
  const violations = [];

  for (const rawRow of rows) {
    const row = rawRow && typeof rawRow === "object" ? rawRow : {};
    const relative = normalizeRelative(row.path);
    const violation = releasePathViolation(relative);
    if (violation) {
      violations.push({ path: relative, violation });
      continue;
    }
    if (!relative || relative === "release-manifest.json" || seen.has(relative)) {
      violations.push({ path: relative, violation: "release_manifest_path_invalid_or_duplicate" });
      continue;
    }
    seen.add(relative);

    const expectedHash = String(row.sha256 || "").toLowerCase();
    const expectedSize = Number(row.size);
    if (!/^[a-f0-9]{64}$/.test(expectedHash) || !Number.isSafeInteger(expectedSize) || expectedSize < 0) {
      violations.push({ path: relative, violation: "release_manifest_file_metadata_invalid" });
      continue;
    }

    const absoluteFile = path.resolve(absoluteRoot, ...relative.split("/"));
    const rootPrefix = `${absoluteRoot}${path.sep}`;
    if (absoluteFile !== absoluteRoot && !absoluteFile.startsWith(rootPrefix)) {
      violations.push({ path: relative, violation: "release_manifest_path_escape" });
      continue;
    }

    let stat;
    try {
      stat = await fs.stat(absoluteFile);
    } catch {
      violations.push({ path: relative, violation: "release_manifest_file_missing" });
      continue;
    }
    if (!stat.isFile() || stat.size !== expectedSize) {
      violations.push({ path: relative, violation: "release_manifest_file_size_mismatch" });
      continue;
    }
    const actualHash = await sha256File(absoluteFile);
    if (actualHash !== expectedHash) {
      violations.push({ path: relative, violation: "release_manifest_file_hash_mismatch" });
    }
  }

  async function findUnexpectedFiles(current = "") {
    const absolute = path.join(absoluteRoot, current);
    const entries = await fs.readdir(absolute, { withFileTypes: true });
    for (const entry of entries) {
      const relative = normalizeRelative(path.join(current, entry.name));
      const topSegment = relative.split("/")[0]?.toLowerCase() || "";
      if ([".git", "dist", "node_modules", "release"].includes(topSegment)) {
        continue;
      }
      if (entry.isSymbolicLink()) {
        violations.push({ path: relative, violation: "symbolic_link_not_allowed" });
        continue;
      }
      if (entry.isDirectory()) {
        const pathViolation = releasePathViolation(relative);
        if (pathViolation) {
          violations.push({ path: relative, violation: pathViolation });
          continue;
        }
        await findUnexpectedFiles(relative);
        continue;
      }
      if (!entry.isFile() || relative === "release-manifest.json") continue;
      const pathViolation = releasePathViolation(relative);
      if (pathViolation) {
        violations.push({ path: relative, violation: pathViolation });
      } else if (!seen.has(relative)) {
        violations.push({ path: relative, violation: "release_manifest_unexpected_file" });
      }
    }
  }
  await findUnexpectedFiles();

  if (violations.length) {
    const error = new Error("release_manifest_verification_failed");
    error.violations = violations;
    throw error;
  }
  return {
    manifest,
    verified_files: rows.length,
  };
}

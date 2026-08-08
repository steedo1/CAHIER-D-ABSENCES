export type ReleaseViolation = {
  path: string;
  violation: string;
  kind?: "directory" | "file" | "symlink";
};

export type ReleaseFile = {
  path: string;
  violation: null;
  kind: "file";
};

export type ReleaseManifestFile = {
  path: string;
  size: number;
  sha256: string;
};

export type ReleaseManifest = {
  manifest_version: 1;
  product: "mon-cahier-relay";
  files: ReleaseManifestFile[];
  [key: string]: unknown;
};

export function releasePathViolation(relativePath: string): string | null;
export function scanReleaseTree(root: string): Promise<{
  root: string;
  entries: Array<ReleaseViolation | ReleaseFile>;
  files: ReleaseFile[];
  violations: ReleaseViolation[];
}>;
export function sha256File(filePath: string): Promise<string>;
export function createReleaseManifest(
  root: string,
  metadata?: Record<string, unknown>,
): Promise<ReleaseManifest>;
export function verifyReleaseManifest(
  root: string,
  manifestPath: string,
): Promise<{ manifest: ReleaseManifest; verified_files: number }>;

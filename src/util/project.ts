import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { ProjectInfo } from "../types.js";

interface RawManifest {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

/** True for a non-null, non-array plain object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value)
  );
}

/**
 * Coerce an arbitrary value into a `Record<string, string>`. A malformed
 * manifest may have e.g. `"dependencies": "lodash"` or `null`; rather than
 * crashing or fabricating index-keyed garbage, we return `{}` for anything that
 * is not a plain object, and keep only string-valued entries.
 */
function asStringRecord(value: unknown): Record<string, string> {
  if (!isPlainObject(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

/**
 * Find the nearest package.json starting at `startPath` and walking up.
 * If `startPath` is a file, its directory is used.
 */
export function findProjectRoot(startPath: string): string | null {
  let dir = resolve(startPath);
  try {
    if (statSync(dir).isFile()) dir = dirname(dir);
  } catch {
    return null;
  }

  while (true) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Load and normalize project info from a root directory. */
export function loadProject(root: string): ProjectInfo {
  const manifestPath = join(root, "package.json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (err) {
    throw new Error(
      `Could not read package.json at ${manifestPath}: ${(err as Error).message}`,
    );
  }

  // A malformed manifest (array / string / null / number) is treated as an
  // empty object so analysis degrades gracefully instead of crashing or
  // producing garbage dependency names.
  const raw: RawManifest = isPlainObject(parsed)
    ? (parsed as RawManifest)
    : {};

  return {
    root,
    manifestPath,
    name: typeof raw.name === "string" ? raw.name : "(unnamed)",
    version: typeof raw.version === "string" ? raw.version : "0.0.0",
    dependencies: asStringRecord(raw.dependencies),
    devDependencies: asStringRecord(raw.devDependencies),
    otherDependencies: {
      ...asStringRecord(raw.peerDependencies),
      ...asStringRecord(raw.optionalDependencies),
    },
    hasNodeModules: existsSync(join(root, "node_modules")),
  };
}

/** Resolve a user-provided path (or cwd) into a ProjectInfo, or throw. */
export function resolveProject(inputPath?: string): ProjectInfo {
  const start = inputPath ? resolve(inputPath) : process.cwd();
  const root = findProjectRoot(start);
  if (!root) {
    throw new Error(
      `No package.json found at or above ${start}. Run depscope inside an npm project.`,
    );
  }
  return loadProject(root);
}

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
  let raw: RawManifest;
  try {
    raw = JSON.parse(readFileSync(manifestPath, "utf8")) as RawManifest;
  } catch (err) {
    throw new Error(
      `Could not read package.json at ${manifestPath}: ${(err as Error).message}`,
    );
  }

  return {
    root,
    manifestPath,
    name: raw.name ?? "(unnamed)",
    version: raw.version ?? "0.0.0",
    dependencies: raw.dependencies ?? {},
    devDependencies: raw.devDependencies ?? {},
    otherDependencies: {
      ...(raw.peerDependencies ?? {}),
      ...(raw.optionalDependencies ?? {}),
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

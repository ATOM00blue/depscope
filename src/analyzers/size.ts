import { readdir, realpath, stat } from "node:fs/promises";
import { join, sep } from "node:path";
import type { DepSize, ProjectInfo, SizeResult } from "../types.js";
import { humanBytes } from "../util/bytes.js";

interface DirStat {
  bytes: number;
  files: number;
}

/**
 * Hard recursion backstop. Real install layouts are nowhere near this deep;
 * this only guards against adversarial / pathological directory nesting in an
 * untrusted project (DoS). Symlink cycles are already prevented by skipping
 * symlinked entries during the walk.
 */
const MAX_DEPTH = 64;

/** True if `child` is the same path as, or nested inside, `parent`. */
function isInside(parent: string, child: string): boolean {
  if (child === parent) return true;
  const withSep = parent.endsWith(sep) ? parent : parent + sep;
  return child.startsWith(withSep);
}

/**
 * Recursively measure the on-disk size and file count of a directory.
 * Pure Node fs — works on Windows (no `du`).
 *
 * Symlinks are NOT followed during the walk (avoids double counting and
 * cycles), and the walk is bounded both by `MAX_DEPTH` and by `rootReal`: any
 * entry whose real path escapes `rootReal` (i.e. a symlink/junction pointing
 * outside node_modules) is skipped, so a hostile project cannot make depscope
 * read or measure files outside the analyzed tree.
 */
async function measureDir(
  dir: string,
  rootReal: string,
  depth = 0,
): Promise<DirStat> {
  let bytes = 0;
  let files = 0;

  if (depth > MAX_DEPTH) return { bytes, files };

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return { bytes, files };
  }

  const subdirs: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    // Never follow symlinks discovered during the walk.
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      subdirs.push(full);
    } else if (entry.isFile()) {
      try {
        const s = await stat(full);
        bytes += s.size;
        files += 1;
      } catch {
        // unreadable file — skip
      }
    }
  }

  // Measure subdirectories with bounded concurrency.
  const results = await mapWithConcurrency(subdirs, 8, (d) =>
    measureDir(d, rootReal, depth + 1),
  );
  for (const r of results) {
    bytes += r.bytes;
    files += r.files;
  }

  return { bytes, files };
}

/**
 * Measure a top-level package directory, refusing to follow it if its real
 * path escapes node_modules. The package dir itself may be a symlink/junction
 * (npm/pnpm/yarn workspaces use these); we resolve it and bail out if the
 * target lives outside the analyzed tree.
 */
async function measurePackage(
  dir: string,
  rootReal: string,
): Promise<DirStat> {
  let real: string;
  try {
    real = await realpath(dir);
  } catch {
    return { bytes: 0, files: 0 };
  }
  if (!isInside(rootReal, real)) {
    // Symlink/junction escaping node_modules — do not traverse outside the tree.
    return { bytes: 0, files: 0 };
  }
  return measureDir(real, rootReal);
}

/** Run an async mapper over items with a concurrency cap. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  const workers = new Array(Math.min(limit, items.length || 1))
    .fill(0)
    .map(async () => {
      while (index < items.length) {
        const current = index++;
        results[current] = await fn(items[current]!);
      }
    });
  await Promise.all(workers);
  return results;
}

/**
 * List the top-level installed package directories in node_modules,
 * expanding scoped packages (`@scope/name`).
 */
async function listInstalledPackages(
  nodeModules: string,
): Promise<{ name: string; dir: string }[]> {
  const out: { name: string; dir: string }[] = [];
  let entries;
  try {
    entries = await readdir(nodeModules, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (entry.name.startsWith(".")) continue; // .bin, .package-lock.json, .cache

    if (entry.name.startsWith("@")) {
      const scopeDir = join(nodeModules, entry.name);
      let scoped;
      try {
        scoped = await readdir(scopeDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const s of scoped) {
        if (s.isDirectory() || s.isSymbolicLink()) {
          out.push({
            name: `${entry.name}/${s.name}`,
            dir: join(scopeDir, s.name),
          });
        }
      }
    } else {
      out.push({ name: entry.name, dir: join(nodeModules, entry.name) });
    }
  }

  return out;
}

/**
 * Analyze install size. Reports total node_modules size plus a per-package
 * breakdown. Because npm installs flatly (hoisted), each top-level package's
 * folder is measured directly; transitive deps live alongside it and are
 * counted in the total. We attribute size to whichever direct/declared dep
 * a folder belongs to, falling back to "(transitive)" aggregate.
 */
export async function analyzeSize(
  project: ProjectInfo,
  top = 10,
): Promise<SizeResult> {
  if (!project.hasNodeModules) {
    return {
      totalBytes: 0,
      totalHuman: "0 B",
      totalFiles: 0,
      deps: [],
      ran: false,
      note: "node_modules not found — run `npm install` first.",
    };
  }

  const nodeModules = join(project.root, "node_modules");
  // Resolve the real path of node_modules once; used to confine the walk so a
  // hostile project cannot make us measure files outside the analyzed tree via
  // a symlinked/junctioned package directory.
  let rootReal: string;
  try {
    rootReal = await realpath(nodeModules);
  } catch {
    rootReal = nodeModules;
  }

  const installed = await listInstalledPackages(nodeModules);

  const declared = new Set([
    ...Object.keys(project.dependencies),
    ...Object.keys(project.devDependencies),
    ...Object.keys(project.otherDependencies),
  ]);

  const measured = await mapWithConcurrency(installed, 6, async (pkg) => {
    const s = await measurePackage(pkg.dir, rootReal);
    return { name: pkg.name, ...s };
  });

  let totalBytes = 0;
  let totalFiles = 0;
  const directSizes: DepSize[] = [];
  let transitiveBytes = 0;
  let transitiveFiles = 0;
  let transitiveCount = 0;

  for (const m of measured) {
    totalBytes += m.bytes;
    totalFiles += m.files;
    if (declared.has(m.name)) {
      directSizes.push({
        name: m.name,
        bytes: m.bytes,
        human: humanBytes(m.bytes),
        files: m.files,
      });
    } else {
      transitiveBytes += m.bytes;
      transitiveFiles += m.files;
      transitiveCount += 1;
    }
  }

  directSizes.sort((a, b) => b.bytes - a.bytes);
  // Guard against negative/NaN `top`, which would otherwise drop deps via a
  // negative slice end. Clamp to a non-negative integer.
  const safeTop =
    Number.isFinite(top) && top >= 0 ? Math.floor(top) : 10;
  const limited = directSizes.slice(0, safeTop);

  if (transitiveCount > 0) {
    limited.push({
      name: `(+${transitiveCount} transitive)`,
      bytes: transitiveBytes,
      human: humanBytes(transitiveBytes),
      files: transitiveFiles,
    });
  }

  return {
    totalBytes,
    totalHuman: humanBytes(totalBytes),
    totalFiles,
    deps: limited,
    ran: true,
  };
}

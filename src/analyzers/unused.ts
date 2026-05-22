import { readFile, readdir, stat } from "node:fs/promises";
import { builtinModules } from "node:module";
import { extname, join } from "node:path";
import type { ProjectInfo, UnusedResult } from "../types.js";

/**
 * Resource bounds against hostile/huge projects. Real source files are tiny;
 * skipping multi-MB "source" files prevents an OOM from a malicious blob, and
 * capping the file count bounds work on pathologically large trees.
 */
const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MiB
const MAX_FILES = 50_000;
const MAX_SCAN_DEPTH = 12;

const SOURCE_EXTS = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".vue",
  ".svelte",
  ".astro",
]);

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".cache",
  ".turbo",
  "vendor",
  "__snapshots__",
]);

const NODE_BUILTINS = new Set<string>([
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
  "node:test",
  "node:sea",
]);

/**
 * Packages that are commonly used implicitly (via config, CLI, plugins, or
 * framework conventions) and should NOT be flagged as unused even when no
 * source `import` references them. depscope errs toward NOT nagging.
 */
const IMPLICIT_USE = new Set<string>([
  "typescript",
  "ts-node",
  "tsx",
  "tsup",
  "esbuild",
  "vite",
  "rollup",
  "webpack",
  "@babel/core",
  "babel-jest",
  "jest",
  "vitest",
  "mocha",
  "ava",
  "nyc",
  "c8",
  "eslint",
  "prettier",
  "husky",
  "lint-staged",
  "nodemon",
  "concurrently",
  "rimraf",
  "cross-env",
  "npm-run-all",
  "dotenv",
  "dotenv-cli",
  "tailwindcss",
  "postcss",
  "autoprefixer",
  "sass",
  "less",
]);

/** Extract the package name from an import specifier. */
export function specifierToPackage(spec: string): string | null {
  if (!spec) return null;
  // Relative / absolute / protocol imports are not packages.
  if (
    spec.startsWith(".") ||
    spec.startsWith("/") ||
    spec.startsWith("#") ||
    /^[a-z]+:/.test(spec) // node:, data:, http:, etc.
  ) {
    return null;
  }

  if (spec.startsWith("@")) {
    const parts = spec.split("/");
    if (parts.length < 2) return null;
    return `${parts[0]}/${parts[1]}`;
  }
  return spec.split("/")[0] ?? null;
}

const IMPORT_PATTERNS: RegExp[] = [
  // import ... from 'x' / import 'x'
  /\bimport\b[^'"]*?['"]([^'"]+)['"]/g,
  // export ... from 'x'
  /\bexport\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g,
  // require('x')
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  // dynamic import('x')
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

/** Find all imported package names within a source string. */
export function extractImports(source: string): Set<string> {
  const found = new Set<string>();
  // Strip line and block comments cheaply to reduce false positives.
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

  for (const pattern of IMPORT_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(stripped)) !== null) {
      const pkg = specifierToPackage(match[1]!);
      if (pkg && !NODE_BUILTINS.has(pkg)) found.add(pkg);
    }
  }
  return found;
}

async function collectSourceFiles(
  dir: string,
  acc: string[],
  depth = 0,
): Promise<void> {
  if (depth > MAX_SCAN_DEPTH) return;
  if (acc.length >= MAX_FILES) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (acc.length >= MAX_FILES) return;
    // Never follow directory symlinks/junctions — avoids cycles and escaping
    // the analyzed tree. (readdir withFileTypes reports junctions as symlinks.)
    if (entry.isSymbolicLink()) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith(".")) continue;
      await collectSourceFiles(full, acc, depth + 1);
    } else if (entry.isFile()) {
      if (SOURCE_EXTS.has(extname(entry.name))) acc.push(full);
    }
  }
}

/** Pull package names referenced in package.json scripts (CLI tools). */
function packagesFromScripts(
  scripts: Record<string, string> | undefined,
  candidates: Set<string>,
): Set<string> {
  const used = new Set<string>();
  if (!scripts) return used;
  const haystack = Object.values(scripts).join(" \n ");
  for (const name of candidates) {
    // Match the package name as a whole word (its bin is usually the same).
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(^|[\\s/])${escaped}([\\s/@]|$)`);
    if (re.test(haystack)) used.add(name);
  }
  return used;
}

/**
 * Detect unused declared dependencies and missing (used-but-undeclared) ones
 * via static analysis of source files. Conservative by design.
 */
export async function analyzeUnused(
  project: ProjectInfo,
  opts: { prod?: boolean } = {},
): Promise<UnusedResult> {
  const files: string[] = [];
  await collectSourceFiles(project.root, files);

  // Read & scan files with bounded concurrency.
  const imported = new Set<string>();
  const concurrency = 16;
  let idx = 0;
  await Promise.all(
    new Array(Math.min(concurrency, files.length || 1)).fill(0).map(async () => {
      while (idx < files.length) {
        const file = files[idx++]!;
        try {
          // Skip oversized files — real source is tiny; this bounds memory
          // against an adversarial multi-MB blob.
          const st = await stat(file);
          if (st.size > MAX_FILE_BYTES) continue;
          const content = await readFile(file, "utf8");
          for (const pkg of extractImports(content)) imported.add(pkg);
        } catch {
          // unreadable — skip
        }
      }
    }),
  );

  const deps = Object.keys(project.dependencies);
  const devDeps = opts.prod ? [] : Object.keys(project.devDependencies);
  const allDeclared = new Set([
    ...deps,
    ...devDeps,
    ...Object.keys(project.otherDependencies),
  ]);

  // Read scripts for CLI-tool usage detection.
  let scriptUsed = new Set<string>();
  try {
    const raw = JSON.parse(await readFile(project.manifestPath, "utf8")) as {
      scripts?: Record<string, string>;
    };
    scriptUsed = packagesFromScripts(raw.scripts, allDeclared);
  } catch {
    // ignore
  }

  /** A declared dep is "used" if imported, referenced in scripts, implicitly
   * used, or is an @types/* package whose base is declared/used. */
  const isUsed = (name: string): boolean => {
    if (imported.has(name)) return true;
    if (scriptUsed.has(name)) return true;
    if (IMPLICIT_USE.has(name)) return true;
    if (name.startsWith("@types/")) {
      // @types/foo supports foo or @scope/foo (encoded as @types/scope__foo)
      const base = name.slice("@types/".length).replace("__", "/");
      if (
        imported.has(base) ||
        allDeclared.has(base) ||
        base === "node" ||
        IMPLICIT_USE.has(base)
      ) {
        return true;
      }
    }
    // eslint-plugin-*, @scope/eslint-config-*, etc. — config-driven tools.
    if (/eslint|prettier|babel|postcss|stylelint|commitlint/.test(name)) {
      return true;
    }
    return false;
  };

  const unused = deps.filter((d) => !isUsed(d)).sort();
  const unusedDev = devDeps.filter((d) => !isUsed(d)).sort();

  // Missing: imported but not declared anywhere and not a builtin.
  const missing = [...imported]
    .filter((pkg) => !allDeclared.has(pkg) && !NODE_BUILTINS.has(pkg))
    .sort();

  return { unused, unusedDev, missing, ran: true };
}

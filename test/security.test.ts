import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { analyzeSize } from "../src/analyzers/size.js";
import { analyzeUnused } from "../src/analyzers/unused.js";
import { loadProject } from "../src/util/project.js";

let work: string;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "depscope-sec-"));
});

afterEach(() => {
  if (work) rmSync(work, { recursive: true, force: true });
});

function writeManifest(dir: string, manifest: unknown): void {
  writeFileSync(join(dir, "package.json"), JSON.stringify(manifest));
}

/**
 * Create a symlink/junction. On Windows, "dir" symlinks need elevation, so use
 * a junction which works without admin. Returns true if it was created.
 */
function tryLinkDir(target: string, linkPath: string): boolean {
  const type = process.platform === "win32" ? "junction" : "dir";
  try {
    symlinkSync(target, linkPath, type);
    return true;
  } catch {
    return false;
  }
}

describe("size analyzer — symlink traversal containment (HIGH)", () => {
  it("does NOT measure a package symlinked outside node_modules", async () => {
    // Project with a node_modules containing a package symlinked to an OUTSIDE
    // directory holding a large file. The walker must refuse to follow it.
    const nm = join(work, "project", "node_modules");
    mkdirSync(nm, { recursive: true });
    writeManifest(join(work, "project"), {
      name: "victim",
      version: "1.0.0",
      dependencies: { evil: "*" },
    });

    const outside = join(work, "outside-target");
    mkdirSync(outside, { recursive: true });
    // 1 MiB file that must NOT be counted.
    writeFileSync(join(outside, "secret.bin"), Buffer.alloc(1024 * 1024));

    const linked = tryLinkDir(outside, join(nm, "evil"));
    if (!linked) {
      // Environment can't create links (no privilege) — skip without failing.
      return;
    }

    const project = loadProject(join(work, "project"));
    const result = await analyzeSize(project, 10);

    expect(result.ran).toBe(true);
    // The 1 MiB outside file must not have been measured.
    expect(result.totalBytes).toBe(0);
    expect(result.totalFiles).toBe(0);
    const evil = result.deps.find((d) => d.name === "evil");
    // Either absent or zero-sized — never the outside payload.
    expect(evil?.bytes ?? 0).toBe(0);
  });

  it("still measures a normal (non-symlinked) package", async () => {
    const nm = join(work, "project", "node_modules");
    const pkg = join(nm, "real-pkg");
    mkdirSync(pkg, { recursive: true });
    writeManifest(join(work, "project"), {
      name: "victim",
      version: "1.0.0",
      dependencies: { "real-pkg": "*" },
    });
    writeFileSync(join(pkg, "index.js"), Buffer.alloc(2048));

    const project = loadProject(join(work, "project"));
    const result = await analyzeSize(project, 10);
    expect(result.ran).toBe(true);
    expect(result.totalBytes).toBeGreaterThanOrEqual(2048);
    const real = result.deps.find((d) => d.name === "real-pkg");
    expect(real?.bytes).toBeGreaterThanOrEqual(2048);
  });

  it("clamps a negative --top instead of dropping deps", async () => {
    const nm = join(work, "project", "node_modules");
    mkdirSync(join(nm, "a"), { recursive: true });
    mkdirSync(join(nm, "b"), { recursive: true });
    writeManifest(join(work, "project"), {
      name: "p",
      version: "1.0.0",
      dependencies: { a: "*", b: "*" },
    });
    writeFileSync(join(nm, "a", "f"), Buffer.alloc(100));
    writeFileSync(join(nm, "b", "f"), Buffer.alloc(50));

    const project = loadProject(join(work, "project"));
    // A negative top must not silently chop deps via slice(0, -n).
    const result = await analyzeSize(project, -1);
    const names = result.deps.map((d) => d.name);
    expect(names).toContain("a");
    expect(names).toContain("b");
  });
});

describe("loadProject — malformed manifest hardening (MEDIUM)", () => {
  it("treats a non-object manifest as empty instead of crashing", () => {
    const dir = join(work, "p");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), "null");
    const project = loadProject(dir);
    expect(project.name).toBe("(unnamed)");
    expect(Object.keys(project.dependencies)).toHaveLength(0);
  });

  it("ignores a string-valued dependencies field (no garbage deps)", () => {
    const dir = join(work, "p");
    mkdirSync(dir, { recursive: true });
    // "dependencies": "lodash" would otherwise become index keys 0..5.
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "p", version: "1.0.0", dependencies: "lodash" }),
    );
    const project = loadProject(dir);
    expect(Object.keys(project.dependencies)).toHaveLength(0);
  });

  it("keeps only string-valued dependency entries", () => {
    const dir = join(work, "p");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "p",
        version: "1.0.0",
        dependencies: { good: "^1.0.0", bad: { nested: true }, alsoBad: 5 },
      }),
    );
    const project = loadProject(dir);
    expect(project.dependencies).toEqual({ good: "^1.0.0" });
  });

  it("handles an array manifest without throwing", () => {
    const dir = join(work, "p");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), "[]");
    expect(() => loadProject(dir)).not.toThrow();
  });
});

describe("unused analyzer — resource bounds (MEDIUM)", () => {
  it("skips oversized source files without crashing", async () => {
    const dir = join(work, "p", "src");
    mkdirSync(dir, { recursive: true });
    writeManifest(join(work, "p"), {
      name: "p",
      version: "1.0.0",
      dependencies: { lodash: "^4.0.0" },
    });
    // A >2 MiB file that imports lodash; it must be skipped (so lodash stays
    // "unused"), and the scan must not OOM or hang.
    const huge =
      `import _ from "lodash";\n` + "// padding\n".repeat(250_000);
    writeFileSync(join(dir, "huge.js"), huge);

    const project = loadProject(join(work, "p"));
    const result = await analyzeUnused(project);
    expect(result.ran).toBe(true);
    // Oversized file skipped => lodash not seen as imported => flagged unused.
    expect(result.unused).toContain("lodash");
  });

  it("does not follow directory symlinks while collecting sources", async () => {
    const proj = join(work, "p");
    const src = join(proj, "src");
    mkdirSync(src, { recursive: true });
    writeManifest(proj, { name: "p", version: "1.0.0", dependencies: {} });
    writeFileSync(join(src, "index.js"), `import a from "alpha";`);

    // An outside dir with a source that imports a package; if followed via a
    // symlink it would appear as "missing". It must be ignored.
    const outside = join(work, "outside");
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "leak.js"), `import secret from "leaked-pkg";`);

    const linked = tryLinkDir(outside, join(src, "linked"));
    const project = loadProject(proj);
    const result = await analyzeUnused(project);
    expect(result.ran).toBe(true);
    if (linked) {
      expect(result.missing).not.toContain("leaked-pkg");
    }
    // The in-tree import is still detected as missing.
    expect(result.missing).toContain("alpha");
  });
});

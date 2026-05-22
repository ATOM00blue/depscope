import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyze } from "../src/index.js";
import { runNpm } from "../src/util/npm.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureSrc = join(here, "fixtures", "sample-project");

let workDir: string;
let installed = false;

describe("end-to-end against a real installed project", () => {
  beforeAll(async () => {
    // Copy fixture to a temp dir and npm install it so node_modules exists.
    workDir = mkdtempSync(join(tmpdir(), "depscope-e2e-"));
    cpSync(fixtureSrc, workDir, { recursive: true });
    const result = await runNpm(
      ["install", "--no-audit", "--no-fund", "--loglevel=error"],
      workDir,
      300_000,
    );
    installed = existsSync(join(workDir, "node_modules"));
    if (!installed) {
      // Surface install output to help debug CI/offline failures.
      // eslint-disable-next-line no-console
      console.warn("npm install did not produce node_modules:", result.stderr);
    }
  }, 300_000);

  afterAll(() => {
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  it("produces a full report with all sections", async () => {
    if (!installed) {
      // Offline environment: don't hard-fail the suite, but assert graceful mode.
      const report = await analyze({ path: workDir });
      expect(report.size?.ran).toBe(false);
      return;
    }

    const report = await analyze({ path: workDir });

    // Project metadata
    expect(report.project.name).toBe("sample-project");
    expect(report.version).toBeTruthy();
    expect(report.health.score).toBeGreaterThanOrEqual(0);
    expect(report.health.score).toBeLessThanOrEqual(100);

    // Size ran and measured something
    expect(report.size?.ran).toBe(true);
    expect(report.size!.totalBytes).toBeGreaterThan(0);
    expect(report.size!.deps.length).toBeGreaterThan(0);

    // Outdated and vuln analyzers ran (results may vary by registry state)
    expect(report.outdated?.ran).toBe(true);
    expect(report.vulnerabilities?.ran).toBe(true);

    // Unused: leftpad is declared but never imported -> unused.
    expect(report.unused?.ran).toBe(true);
    expect(report.unused!.unused).toContain("leftpad");
    // is-odd IS used -> not unused.
    expect(report.unused!.unused).not.toContain("is-odd");
  });

  it("supports running a single section", async () => {
    if (!installed) return;
    const report = await analyze({ path: workDir, sections: ["unused"] });
    expect(report.unused?.ran).toBe(true);
    expect(report.size).toBeUndefined();
    expect(report.outdated).toBeUndefined();
    expect(report.vulnerabilities).toBeUndefined();
  });
});

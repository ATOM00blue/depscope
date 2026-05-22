import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeUnused } from "../src/analyzers/unused.js";
import { loadProject } from "../src/util/project.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, "fixtures", "unused-project");

describe("analyzeUnused (static, no install required)", () => {
  it("flags unused deps, unused devDeps, and missing imports", async () => {
    const project = loadProject(fixture);
    const result = await analyzeUnused(project);

    expect(result.ran).toBe(true);

    // lodash and left-pad are declared but never imported.
    expect(result.unused).toContain("lodash");
    expect(result.unused).toContain("left-pad");
    // chalk IS imported, so it must not be flagged.
    expect(result.unused).not.toContain("chalk");

    // express is imported but not declared -> missing.
    expect(result.missing).toContain("express");

    // Build/lint tools used in scripts or implicitly should not be flagged.
    expect(result.unusedDev).not.toContain("typescript");
    expect(result.unusedDev).not.toContain("tsup");
    expect(result.unusedDev).not.toContain("eslint");
    expect(result.unusedDev).not.toContain("vitest");

    // A genuinely unused dev tool is flagged.
    expect(result.unusedDev).toContain("some-unused-dev-tool");
  });

  it("respects --prod by ignoring devDependencies", async () => {
    const project = loadProject(fixture);
    const result = await analyzeUnused(project, { prod: true });
    expect(result.unusedDev).toHaveLength(0);
    // prod deps still analyzed
    expect(result.unused).toContain("lodash");
  });
});

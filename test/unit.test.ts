import { describe, expect, it } from "vitest";
import { humanBytes } from "../src/util/bytes.js";
import { classifyJump } from "../src/analyzers/outdated.js";
import {
  extractImports,
  specifierToPackage,
} from "../src/analyzers/unused.js";
import { computeHealth } from "../src/util/score.js";
import { parseNpmJson } from "../src/util/npm.js";

describe("humanBytes", () => {
  it("formats bytes", () => {
    expect(humanBytes(0)).toBe("0 B");
    expect(humanBytes(512)).toBe("512 B");
    expect(humanBytes(1024)).toBe("1.0 KB");
    expect(humanBytes(1536)).toBe("1.5 KB");
    expect(humanBytes(1024 * 1024)).toBe("1.0 MB");
    expect(humanBytes(1024 * 1024 * 1024)).toBe("1.0 GB");
  });

  it("drops decimals for large values within a unit", () => {
    expect(humanBytes(150 * 1024)).toBe("150 KB");
  });

  it("handles invalid input", () => {
    expect(humanBytes(-5)).toBe("0 B");
    expect(humanBytes(NaN)).toBe("0 B");
  });
});

describe("classifyJump", () => {
  it("detects major/minor/patch", () => {
    expect(classifyJump("1.0.0", "2.0.0")).toBe("major");
    expect(classifyJump("1.0.0", "1.2.0")).toBe("minor");
    expect(classifyJump("1.0.0", "1.0.5")).toBe("patch");
  });

  it("handles prefixes and equal versions", () => {
    expect(classifyJump("^1.0.0", "1.0.0")).toBe("unknown");
    expect(classifyJump("1.2.3", "1.2.3")).toBe("unknown");
  });

  it("returns unknown for garbage", () => {
    expect(classifyJump("latest", "next")).toBe("unknown");
  });
});

describe("specifierToPackage", () => {
  it("resolves plain and scoped packages", () => {
    expect(specifierToPackage("lodash")).toBe("lodash");
    expect(specifierToPackage("lodash/merge")).toBe("lodash");
    expect(specifierToPackage("@scope/pkg")).toBe("@scope/pkg");
    expect(specifierToPackage("@scope/pkg/sub")).toBe("@scope/pkg");
  });

  it("ignores relative, absolute, protocol, and subpath imports", () => {
    expect(specifierToPackage("./local")).toBeNull();
    expect(specifierToPackage("../up")).toBeNull();
    expect(specifierToPackage("/abs")).toBeNull();
    expect(specifierToPackage("node:fs")).toBeNull();
    expect(specifierToPackage("#internal")).toBeNull();
  });
});

describe("extractImports", () => {
  it("finds esm, cjs, dynamic, and re-export imports", () => {
    const src = `
      import a from "alpha";
      import { b } from 'beta';
      export * from "gamma";
      const d = require("delta");
      const e = await import('epsilon');
      import "side-effect";
    `;
    const found = extractImports(src);
    expect(found.has("alpha")).toBe(true);
    expect(found.has("beta")).toBe(true);
    expect(found.has("gamma")).toBe(true);
    expect(found.has("delta")).toBe(true);
    expect(found.has("epsilon")).toBe(true);
    expect(found.has("side-effect")).toBe(true);
  });

  it("ignores builtins and relative imports", () => {
    const src = `import fs from "node:fs"; import x from "./x"; import path from "path";`;
    const found = extractImports(src);
    expect(found.has("node:fs")).toBe(false);
    expect(found.has("path")).toBe(false);
    expect(found.size).toBe(0);
  });

  it("ignores imports inside comments", () => {
    const src = `// import ghost from "ghost-pkg"\n/* require("block-ghost") */\nimport real from "real-pkg";`;
    const found = extractImports(src);
    expect(found.has("real-pkg")).toBe(true);
    expect(found.has("ghost-pkg")).toBe(false);
    expect(found.has("block-ghost")).toBe(false);
  });
});

describe("computeHealth", () => {
  it("returns 100/A for a clean project", () => {
    const h = computeHealth({ totalDeclaredDeps: 5 });
    expect(h.score).toBe(100);
    expect(h.grade).toBe("A");
    expect(h.reasons).toHaveLength(0);
  });

  it("penalizes vulnerabilities by severity", () => {
    const h = computeHealth({
      totalDeclaredDeps: 5,
      vulnerabilities: {
        ran: true,
        total: 1,
        counts: { critical: 1, high: 0, moderate: 0, low: 0 },
        packages: [],
      },
    });
    expect(h.score).toBe(80); // -20 for one critical
    expect(h.reasons[0]).toContain("vulnerabilit");
  });

  it("clamps and grades F for a disaster", () => {
    const h = computeHealth({
      totalDeclaredDeps: 50,
      vulnerabilities: {
        ran: true,
        total: 10,
        counts: { critical: 10, high: 0, moderate: 0, low: 0 },
        packages: [],
      },
    });
    expect(h.score).toBeGreaterThanOrEqual(0);
    expect(h.grade).toBe("F");
  });
});

describe("parseNpmJson", () => {
  it("parses clean json", () => {
    expect(parseNpmJson<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it("recovers json after leading npm warnings", () => {
    const out = 'npm warn config foo\n{"a":1}';
    expect(parseNpmJson<{ a: number }>(out)).toEqual({ a: 1 });
  });

  it("returns null for empty / unparseable", () => {
    expect(parseNpmJson("")).toBeNull();
    expect(parseNpmJson("not json at all")).toBeNull();
  });
});

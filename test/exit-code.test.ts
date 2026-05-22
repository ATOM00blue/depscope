import { describe, expect, it } from "vitest";
import { exitCodeFor } from "../src/cli.js";
import type { Report } from "../src/types.js";

function baseReport(overrides: Partial<Report> = {}): Report {
  return {
    project: {
      root: "/x",
      manifestPath: "/x/package.json",
      name: "x",
      version: "1.0.0",
      dependencies: {},
      devDependencies: {},
      otherDependencies: {},
      hasNodeModules: true,
    },
    health: { score: 100, grade: "A", reasons: [] },
    generatedAt: new Date().toISOString(),
    version: "1.0.0",
    ...overrides,
  };
}

describe("exitCodeFor", () => {
  it("returns 0 when no --fail-on is set, even with findings", () => {
    const report = baseReport({
      vulnerabilities: {
        ran: true,
        total: 3,
        counts: { critical: 3, high: 0, moderate: 0, low: 0 },
        packages: [],
      },
    });
    expect(exitCodeFor(report, undefined)).toBe(0);
  });

  it("fails when a vuln meets the severity threshold", () => {
    const report = baseReport({
      vulnerabilities: {
        ran: true,
        total: 1,
        counts: { critical: 0, high: 1, moderate: 0, low: 0 },
        packages: [],
      },
    });
    expect(exitCodeFor(report, "high")).toBe(1);
    expect(exitCodeFor(report, "critical")).toBe(0); // only high present
    expect(exitCodeFor(report, "moderate")).toBe(1); // high >= moderate
  });

  it("--fail-on any catches outdated and unused too", () => {
    const outdatedReport = baseReport({
      outdated: {
        ran: true,
        deps: [
          {
            name: "x",
            current: "1.0.0",
            wanted: "1.0.0",
            latest: "2.0.0",
            kind: "major",
            type: "dependencies",
          },
        ],
      },
    });
    expect(exitCodeFor(outdatedReport, "any")).toBe(1);

    const cleanReport = baseReport();
    expect(exitCodeFor(cleanReport, "any")).toBe(0);
  });
});

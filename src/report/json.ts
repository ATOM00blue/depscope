import type { Report } from "../types.js";

/**
 * Produce the stable machine-readable JSON shape. Kept as a dedicated function
 * so the public contract is explicit and testable.
 */
export function toJson(report: Report): string {
  const payload = {
    depscopeVersion: report.version,
    generatedAt: report.generatedAt,
    project: {
      name: report.project.name,
      version: report.project.version,
      root: report.project.root,
      dependencies: Object.keys(report.project.dependencies).length,
      devDependencies: Object.keys(report.project.devDependencies).length,
    },
    health: report.health,
    size: report.size,
    outdated: report.outdated,
    vulnerabilities: report.vulnerabilities,
    unused: report.unused,
  };
  return JSON.stringify(payload, null, 2);
}

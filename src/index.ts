import { analyzeOutdated } from "./analyzers/outdated.js";
import { analyzeSize } from "./analyzers/size.js";
import { analyzeUnused } from "./analyzers/unused.js";
import { analyzeVulnerabilities } from "./analyzers/vulnerabilities.js";
import type { AnalyzeOptions, Report, Section } from "./types.js";
import { resolveProject } from "./util/project.js";
import { computeHealth } from "./util/score.js";

export const VERSION = "1.0.1";

export * from "./types.js";
export { renderTable } from "./report/table.js";
export { toJson } from "./report/json.js";

const ALL_SECTIONS: Section[] = ["vuln", "outdated", "size", "unused"];

/**
 * Run a full (or partial) dependency analysis on a project and return a
 * structured {@link Report}. This is the programmatic entry point; the CLI is a
 * thin wrapper around it.
 */
export async function analyze(options: AnalyzeOptions = {}): Promise<Report> {
  const project = resolveProject(options.path);
  const sections =
    options.sections && options.sections.length > 0
      ? options.sections
      : ALL_SECTIONS;
  const wants = (s: Section) => sections.includes(s);
  const top = options.top ?? 10;
  const prod = options.prod ?? false;
  const progress = options.onProgress ?? (() => {});

  // Run all requested analyzers concurrently — they are independent.
  const tasks: Promise<void>[] = [];
  const report: Partial<Report> = {};

  if (wants("vuln")) {
    progress("Auditing vulnerabilities…");
    tasks.push(
      analyzeVulnerabilities(project, { prod }).then((r) => {
        report.vulnerabilities = r;
      }),
    );
  }
  if (wants("outdated")) {
    progress("Checking outdated packages…");
    tasks.push(
      analyzeOutdated(project, { prod }).then((r) => {
        report.outdated = r;
      }),
    );
  }
  if (wants("size")) {
    progress("Measuring install size…");
    tasks.push(
      analyzeSize(project, top).then((r) => {
        report.size = r;
      }),
    );
  }
  if (wants("unused")) {
    progress("Scanning for unused dependencies…");
    tasks.push(
      analyzeUnused(project, { prod }).then((r) => {
        report.unused = r;
      }),
    );
  }

  await Promise.all(tasks);

  const health = computeHealth({
    size: report.size,
    outdated: report.outdated,
    vulnerabilities: report.vulnerabilities,
    unused: report.unused,
    totalDeclaredDeps:
      Object.keys(project.dependencies).length +
      Object.keys(project.devDependencies).length,
  });

  return {
    project,
    size: report.size,
    outdated: report.outdated,
    vulnerabilities: report.vulnerabilities,
    unused: report.unused,
    health,
    generatedAt: new Date().toISOString(),
    version: VERSION,
  };
}

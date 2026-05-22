import { Command } from "commander";
import chalk from "chalk";
import { analyze, VERSION } from "./index.js";
import { renderTable } from "./report/table.js";
import { toJson } from "./report/json.js";
import type { Report, Section, Severity } from "./types.js";

interface CliOptions {
  size?: boolean;
  outdated?: boolean;
  vuln?: boolean;
  unused?: boolean;
  json?: boolean;
  color?: boolean;
  top?: string;
  prod?: boolean;
  failOn?: string;
}

/** A tiny stderr spinner so the (slowish) npm subcommands feel responsive. */
function createSpinner(enabled: boolean) {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;
  let timer: NodeJS.Timeout | null = null;
  let text = "";
  return {
    start(message: string) {
      text = message;
      if (!enabled) return;
      timer = setInterval(() => {
        process.stderr.write(`\r${chalk.cyan(frames[i++ % frames.length])} ${text}   `);
      }, 80);
    },
    update(message: string) {
      text = message;
    },
    stop() {
      if (timer) clearInterval(timer);
      if (enabled) process.stderr.write("\r" + " ".repeat(text.length + 6) + "\r");
    },
  };
}

const SEVERITY_RANK: Record<Severity, number> = {
  low: 1,
  moderate: 2,
  high: 3,
  critical: 4,
};

/** Decide the process exit code based on --fail-on. */
export function exitCodeFor(report: Report, failOn: string | undefined): number {
  if (!failOn) return 0;
  const lower = failOn.toLowerCase();

  if (lower === "any") {
    const hasVuln = (report.vulnerabilities?.total ?? 0) > 0;
    const hasOutdated = (report.outdated?.deps.length ?? 0) > 0;
    const u = report.unused;
    const hasUnused =
      u && (u.unused.length > 0 || u.unusedDev.length > 0 || u.missing.length > 0);
    return hasVuln || hasOutdated || hasUnused ? 1 : 0;
  }

  if (lower in SEVERITY_RANK) {
    const threshold = SEVERITY_RANK[lower as Severity];
    const counts = report.vulnerabilities?.counts;
    if (!counts) return 0;
    const max = (Object.keys(counts) as Severity[]).reduce(
      (m, sev) => (counts[sev] > 0 ? Math.max(m, SEVERITY_RANK[sev]) : m),
      0,
    );
    return max >= threshold ? 1 : 0;
  }

  return 0;
}

function selectedSections(opts: CliOptions): Section[] {
  const sections: Section[] = [];
  if (opts.size) sections.push("size");
  if (opts.outdated) sections.push("outdated");
  if (opts.vuln) sections.push("vuln");
  if (opts.unused) sections.push("unused");
  return sections; // empty => all
}

async function main(argv: string[]): Promise<void> {
  const program = new Command();

  program
    .name("depscope")
    .description(
      "Instant dependency report for any npm project: install size, outdated, vulnerabilities, and unused deps in one command.",
    )
    .version(VERSION, "-v, --version", "output the version number")
    .argument("[path]", "path to the project (defaults to current directory)")
    .option("--size", "run install-size analysis only")
    .option("--outdated", "run outdated check only")
    .option("--vuln", "run vulnerability audit only")
    .option("--unused", "run unused/missing analysis only")
    .option("--json", "output machine-readable JSON")
    .option("--no-color", "disable colored output")
    .option("--top <n>", "show top N largest dependencies", "10")
    .option("--prod", "ignore devDependencies")
    .option(
      "--fail-on <level>",
      "exit non-zero on findings: low|moderate|high|critical|any",
    )
    .addHelpText(
      "after",
      `
Examples:
  $ npx depscope                 Full report for the current project
  $ npx depscope ./my-app        Report for a specific project
  $ npx depscope --vuln --outdated   Only audit + outdated
  $ npx depscope --json > report.json
  $ npx depscope --fail-on high  Exit 1 if a high/critical vuln exists (CI)
`,
    );

  program.parse(argv);
  const opts = program.opts<CliOptions>();
  const path = program.args[0];

  // chalk respects FORCE_COLOR/NO_COLOR; honor --no-color explicitly.
  if (opts.color === false) chalk.level = 0;

  const asJson = Boolean(opts.json);
  const spinner = createSpinner(!asJson && process.stderr.isTTY === true);

  try {
    const parsedTop = Number.parseInt(opts.top ?? "10", 10);
    // Clamp to a sane non-negative integer; a negative `--top` would otherwise
    // drop the largest deps via a negative slice end.
    const top = Number.isFinite(parsedTop) && parsedTop >= 0 ? parsedTop : 10;
    spinner.start("Analyzing dependencies…");

    const report = await analyze({
      path,
      sections: selectedSections(opts),
      prod: opts.prod,
      top,
      onProgress: (m) => spinner.update(m),
    });

    spinner.stop();

    if (asJson) {
      process.stdout.write(toJson(report) + "\n");
    } else {
      process.stdout.write(renderTable(report) + "\n");
    }

    process.exitCode = exitCodeFor(report, opts.failOn);
  } catch (err) {
    spinner.stop();
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(chalk.red(`\nerror: ${message}\n`));
    process.exitCode = 2;
  }
}

void main(process.argv);

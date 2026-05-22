import chalk from "chalk";
import Table from "cli-table3";
import type { Report, Severity } from "../types.js";

const SEVERITY_COLOR: Record<Severity, (s: string) => string> = {
  critical: (s) => chalk.bgRed.white.bold(` ${s} `),
  high: (s) => chalk.red.bold(s),
  moderate: (s) => chalk.yellow(s),
  low: (s) => chalk.gray(s),
};

function gradeColor(grade: string): string {
  switch (grade) {
    case "A":
      return chalk.green.bold(grade);
    case "B":
      return chalk.greenBright.bold(grade);
    case "C":
      return chalk.yellow.bold(grade);
    case "D":
      return chalk.hex("#ff8c00").bold(grade);
    default:
      return chalk.red.bold(grade);
  }
}

function bar(score: number): string {
  const width = 20;
  const filled = Math.round((score / 100) * width);
  const color =
    score >= 80 ? chalk.green : score >= 60 ? chalk.yellow : chalk.red;
  return color("█".repeat(filled)) + chalk.gray("░".repeat(width - filled));
}

function header(title: string): string {
  return "\n" + chalk.bold.cyan(title) + "\n";
}

function makeTable(head: string[]): InstanceType<typeof Table> {
  return new Table({
    head: head.map((h) => chalk.bold.white(h)),
    style: { head: [], border: ["gray"] },
    chars: {
      top: "─",
      "top-mid": "┬",
      "top-left": "┌",
      "top-right": "┐",
      bottom: "─",
      "bottom-mid": "┴",
      "bottom-left": "└",
      "bottom-right": "┘",
      left: "│",
      "left-mid": "├",
      mid: "─",
      "mid-mid": "┼",
      right: "│",
      "right-mid": "┤",
      middle: "│",
    },
  });
}

/** Render the full report as a colorized terminal string. */
export function renderTable(report: Report): string {
  const lines: string[] = [];

  // ---- Headline ----
  const p = report.project;
  lines.push("");
  lines.push(
    chalk.bold.white("  depscope  ") +
      chalk.gray(`v${report.version}`) +
      chalk.gray("  ·  ") +
      chalk.white(`${p.name}@${p.version}`),
  );
  const depCount = Object.keys(p.dependencies).length;
  const devCount = Object.keys(p.devDependencies).length;
  lines.push(
    chalk.gray(
      `  ${depCount} dependencies · ${devCount} devDependencies`,
    ),
  );

  const h = report.health;
  lines.push("");
  lines.push(
    `  Health  ${bar(h.score)}  ${chalk.bold(String(h.score))}${chalk.gray(
      "/100",
    )}  ${gradeColor(h.grade)}`,
  );
  if (h.reasons.length) {
    lines.push(chalk.gray(`          ${h.reasons.join("  ·  ")}`));
  }

  // ---- Vulnerabilities ----
  if (report.vulnerabilities) {
    const v = report.vulnerabilities;
    lines.push(header("Vulnerabilities"));
    if (!v.ran) {
      lines.push(chalk.gray(`  skipped — ${v.note ?? "not run"}`));
    } else if (v.total === 0) {
      lines.push(chalk.green("  ✔ No known vulnerabilities"));
    } else {
      const summary = (["critical", "high", "moderate", "low"] as Severity[])
        .filter((s) => v.counts[s] > 0)
        .map((s) => SEVERITY_COLOR[s](`${v.counts[s]} ${s}`))
        .join("  ");
      lines.push(`  ${summary}`);
      const t = makeTable(["Package", "Severity", "Fix", "Advisory"]);
      for (const pkg of v.packages.slice(0, 20)) {
        const fix =
          pkg.fixAvailable === false
            ? chalk.red("none")
            : pkg.fixIsBreaking
              ? chalk.yellow("breaking")
              : chalk.green("available");
        t.push([
          pkg.name,
          SEVERITY_COLOR[pkg.severity](pkg.severity),
          fix,
          chalk.gray(truncate(pkg.via[0] ?? "", 40)),
        ]);
      }
      lines.push(indent(t.toString()));
      if (v.packages.length > 20) {
        lines.push(chalk.gray(`  …and ${v.packages.length - 20} more`));
      }
      lines.push(chalk.gray("  Run `npm audit fix` to resolve."));
    }
  }

  // ---- Outdated ----
  if (report.outdated) {
    const o = report.outdated;
    lines.push(header("Outdated"));
    if (!o.ran) {
      lines.push(chalk.gray(`  skipped — ${o.note ?? "not run"}`));
    } else if (o.deps.length === 0) {
      lines.push(chalk.green("  ✔ Everything is up to date"));
    } else {
      const t = makeTable(["Package", "Current", "Wanted", "Latest", "Jump"]);
      for (const d of o.deps.slice(0, 25)) {
        const jump =
          d.kind === "major"
            ? chalk.red.bold("major")
            : d.kind === "minor"
              ? chalk.yellow("minor")
              : d.kind === "patch"
                ? chalk.green("patch")
                : chalk.gray("—");
        t.push([
          d.name,
          chalk.gray(d.current),
          chalk.cyan(d.wanted),
          colorLatest(d.latest, d.kind),
          jump,
        ]);
      }
      lines.push(indent(t.toString()));
      if (o.deps.length > 25) {
        lines.push(chalk.gray(`  …and ${o.deps.length - 25} more`));
      }
    }
  }

  // ---- Install size ----
  if (report.size) {
    const s = report.size;
    lines.push(header("Install size"));
    if (!s.ran) {
      lines.push(chalk.gray(`  skipped — ${s.note ?? "not run"}`));
    } else {
      lines.push(
        `  Total node_modules: ${chalk.bold(s.totalHuman)} ${chalk.gray(
          `(${s.totalFiles.toLocaleString()} files)`,
        )}`,
      );
      if (s.deps.length) {
        const t = makeTable(["Package", "Size", "Files", "Share"]);
        for (const d of s.deps) {
          const share =
            s.totalBytes > 0 ? (d.bytes / s.totalBytes) * 100 : 0;
          t.push([
            d.name.startsWith("(") ? chalk.gray(d.name) : d.name,
            chalk.bold(d.human),
            chalk.gray(d.files.toLocaleString()),
            shareBar(share),
          ]);
        }
        lines.push(indent(t.toString()));
      }
    }
  }

  // ---- Unused / missing ----
  if (report.unused) {
    const u = report.unused;
    lines.push(header("Unused & missing"));
    if (!u.ran) {
      lines.push(chalk.gray(`  skipped — ${u.note ?? "not run"}`));
    } else {
      const totalUnused = u.unused.length + u.unusedDev.length;
      if (totalUnused === 0 && u.missing.length === 0) {
        lines.push(chalk.green("  ✔ No unused or missing dependencies"));
      } else {
        if (u.unused.length) {
          lines.push(
            `  ${chalk.yellow("Unused dependencies:")} ${u.unused
              .map((d) => chalk.white(d))
              .join(", ")}`,
          );
        }
        if (u.unusedDev.length) {
          lines.push(
            `  ${chalk.yellow("Unused devDependencies:")} ${u.unusedDev
              .map((d) => chalk.gray(d))
              .join(", ")}`,
          );
        }
        if (u.missing.length) {
          lines.push(
            `  ${chalk.red("Missing (used, not declared):")} ${u.missing
              .map((d) => chalk.redBright(d))
              .join(", ")}`,
          );
        }
      }
    }
  }

  lines.push("");
  return lines.join("\n");
}

function colorLatest(latest: string, kind: string): string {
  if (kind === "major") return chalk.red(latest);
  if (kind === "minor") return chalk.yellow(latest);
  return chalk.green(latest);
}

function shareBar(pct: number): string {
  const width = 12;
  const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
  return (
    chalk.cyan("▉".repeat(filled)) +
    chalk.gray("·".repeat(width - filled)) +
    chalk.gray(` ${pct.toFixed(0)}%`)
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function indent(block: string, spaces = 2): string {
  const pad = " ".repeat(spaces);
  return block
    .split("\n")
    .map((l) => pad + l)
    .join("\n");
}

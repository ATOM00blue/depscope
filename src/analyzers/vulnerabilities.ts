import type {
  ProjectInfo,
  Severity,
  VulnPackage,
  VulnResult,
} from "../types.js";
import { parseNpmJson, runNpm } from "../util/npm.js";

const SEVERITIES: Severity[] = ["low", "moderate", "high", "critical"];

/** npm v7+ audit JSON: a `via` entry is either a package name or an advisory. */
interface AuditVia {
  source?: number;
  name?: string;
  title?: string;
  url?: string;
  severity?: string;
  range?: string;
}

interface AuditVulnerability {
  name?: string;
  severity?: string;
  via?: Array<string | AuditVia>;
  range?: string;
  fixAvailable?: boolean | { name: string; version: string; isSemVerMajor: boolean };
}

interface AuditMetadata {
  vulnerabilities?: Partial<Record<Severity | "info" | "total", number>>;
}

interface NpmAuditJson {
  vulnerabilities?: Record<string, AuditVulnerability>;
  metadata?: AuditMetadata;
  // npm v6 legacy shape (kept for resilience):
  advisories?: Record<string, { module_name?: string; severity?: string; title?: string }>;
}

function normalizeSeverity(s: string | undefined): Severity {
  if (s === "critical" || s === "high" || s === "moderate" || s === "low") {
    return s;
  }
  return "low";
}

/**
 * Run `npm audit --json`. Exits non-zero when vulnerabilities exist; we parse
 * stdout regardless. Handles the npm v7+ `vulnerabilities` map (with the
 * string|object `via` quirk) and falls back gracefully.
 */
export async function analyzeVulnerabilities(
  project: ProjectInfo,
  opts: { prod?: boolean } = {},
): Promise<VulnResult> {
  const emptyCounts: Record<Severity, number> = {
    low: 0,
    moderate: 0,
    high: 0,
    critical: 0,
  };

  if (!project.hasNodeModules) {
    return {
      packages: [],
      counts: emptyCounts,
      total: 0,
      ran: false,
      note: "node_modules not found — run `npm install` first.",
    };
  }

  const args = ["audit", "--json"];
  if (opts.prod) args.push("--omit=dev");

  let result;
  try {
    result = await runNpm(args, project.root);
  } catch (err) {
    return {
      packages: [],
      counts: emptyCounts,
      total: 0,
      ran: false,
      note: (err as Error).message,
    };
  }

  const parsed = parseNpmJson<NpmAuditJson>(result.stdout);
  if (!parsed) {
    // Often happens with no lockfile. Surface a hint instead of crashing.
    const hint = /lockfile|package-lock|requires existing/i.test(result.stderr)
      ? "audit needs a package-lock.json — run `npm install` to generate one."
      : "could not parse `npm audit` output.";
    return { packages: [], counts: emptyCounts, total: 0, ran: false, note: hint };
  }

  const counts: Record<Severity, number> = { ...emptyCounts };
  const packages: VulnPackage[] = [];

  if (parsed.vulnerabilities) {
    for (const [name, vuln] of Object.entries(parsed.vulnerabilities)) {
      const severity = normalizeSeverity(vuln.severity);
      const viaTitles: string[] = [];
      for (const via of vuln.via ?? []) {
        if (typeof via === "string") {
          viaTitles.push(via);
        } else if (via.title) {
          viaTitles.push(via.title);
        } else if (via.name) {
          viaTitles.push(via.name);
        }
      }

      let fixAvailable: boolean | string = false;
      let fixIsBreaking = false;
      if (typeof vuln.fixAvailable === "boolean") {
        fixAvailable = vuln.fixAvailable;
      } else if (vuln.fixAvailable && typeof vuln.fixAvailable === "object") {
        fixAvailable = `${vuln.fixAvailable.name}@${vuln.fixAvailable.version}`;
        fixIsBreaking = Boolean(vuln.fixAvailable.isSemVerMajor);
      }

      packages.push({
        name: vuln.name ?? name,
        severity,
        via: [...new Set(viaTitles)],
        range: vuln.range ?? "*",
        fixAvailable,
        fixIsBreaking,
      });
    }
  }

  // Prefer authoritative counts from metadata when present.
  const meta = parsed.metadata?.vulnerabilities;
  if (meta) {
    for (const sev of SEVERITIES) counts[sev] = meta[sev] ?? 0;
  } else {
    for (const p of packages) counts[p.severity] += 1;
  }

  const total = SEVERITIES.reduce((sum, sev) => sum + counts[sev], 0);

  // Sort by severity (critical first), then name.
  const sevRank: Record<Severity, number> = {
    critical: 0,
    high: 1,
    moderate: 2,
    low: 3,
  };
  packages.sort(
    (a, b) => sevRank[a.severity] - sevRank[b.severity] || a.name.localeCompare(b.name),
  );

  return { packages, counts, total, ran: true };
}

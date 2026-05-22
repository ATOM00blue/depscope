/**
 * Shared types for depscope analyzers and report.
 * Every analyzer returns a result that plugs into {@link Report}.
 */

export type Severity = "low" | "moderate" | "high" | "critical";

export interface ProjectInfo {
  /** Absolute path to the project root (dir containing package.json). */
  root: string;
  /** Absolute path to package.json. */
  manifestPath: string;
  name: string;
  version: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  /** peerDependencies + optionalDependencies, merged (treated as expected). */
  otherDependencies: Record<string, string>;
  /** True if a node_modules directory exists at the root. */
  hasNodeModules: boolean;
}

/** Per-dependency install size on disk. */
export interface DepSize {
  name: string;
  /** Size in bytes of this package's own folder in node_modules. */
  bytes: number;
  /** Human-readable size, e.g. "1.2 MB". */
  human: string;
  /** Number of files in the package folder. */
  files: number;
}

export interface SizeResult {
  /** Total size of node_modules in bytes. */
  totalBytes: number;
  totalHuman: string;
  /** Total file count under node_modules. */
  totalFiles: number;
  /** Per-direct-dependency sizes, sorted largest first. */
  deps: DepSize[];
  /** Whether the analysis ran (false if node_modules missing). */
  ran: boolean;
  /** Optional human-readable note (e.g. why it was skipped). */
  note?: string;
}

export type OutdatedKind = "patch" | "minor" | "major" | "unknown";

export interface OutdatedDep {
  name: string;
  current: string;
  wanted: string;
  latest: string;
  /** Type of the largest jump from current to latest. */
  kind: OutdatedKind;
  /** "dependencies" | "devDependencies" | other. */
  type: string;
}

export interface OutdatedResult {
  deps: OutdatedDep[];
  ran: boolean;
  note?: string;
}

export interface VulnPackage {
  name: string;
  severity: Severity;
  /** Number of distinct advisories affecting this package. */
  via: string[];
  range: string;
  /** Whether `npm audit fix` can resolve it without a breaking change. */
  fixAvailable: boolean | string;
  /** True if the fix requires a semver-major bump. */
  fixIsBreaking: boolean;
}

export interface VulnResult {
  packages: VulnPackage[];
  counts: Record<Severity, number>;
  total: number;
  ran: boolean;
  note?: string;
}

export interface UnusedResult {
  /** Declared in package.json but never imported. */
  unused: string[];
  /** Declared devDependencies never imported. */
  unusedDev: string[];
  /** Imported in source but not declared anywhere. */
  missing: string[];
  ran: boolean;
  note?: string;
}

export interface HealthScore {
  /** 0–100, higher is better. */
  score: number;
  /** Letter grade A–F. */
  grade: string;
  /** Short reasons that reduced the score. */
  reasons: string[];
}

export interface Report {
  project: ProjectInfo;
  size?: SizeResult;
  outdated?: OutdatedResult;
  vulnerabilities?: VulnResult;
  unused?: UnusedResult;
  health: HealthScore;
  /** ISO timestamp of when the report was generated. */
  generatedAt: string;
  /** depscope version. */
  version: string;
}

export interface AnalyzeOptions {
  /** Project path (defaults to cwd, then walks up to find package.json). */
  path?: string;
  /** Which sections to run. If none specified, all run. */
  sections?: Section[];
  /** Ignore devDependencies in analysis. */
  prod?: boolean;
  /** How many largest deps to keep in size result. */
  top?: number;
  /** Signal used by CLI to update a spinner; optional. */
  onProgress?: (message: string) => void;
}

export type Section = "size" | "outdated" | "vuln" | "unused";

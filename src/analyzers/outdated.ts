import type {
  OutdatedDep,
  OutdatedKind,
  OutdatedResult,
  ProjectInfo,
} from "../types.js";
import { parseNpmJson, runNpm } from "../util/npm.js";

/** Shape of each entry in `npm outdated --json`. */
interface NpmOutdatedEntry {
  current?: string;
  wanted?: string;
  latest?: string;
  dependent?: string;
  location?: string;
  type?: string;
}

/** Parse a semver-ish string into [major, minor, patch]; non-numeric -> NaN. */
function parseVersion(v: string): [number, number, number] | null {
  if (!v) return null;
  const clean = v.replace(/^[^\d]*/, "");
  const parts = clean.split(".").map((p) => parseInt(p, 10));
  if (parts.length < 1 || Number.isNaN(parts[0])) return null;
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

/** Classify the jump from `current` to `latest`. */
export function classifyJump(current: string, latest: string): OutdatedKind {
  const c = parseVersion(current);
  const l = parseVersion(latest);
  if (!c || !l) return "unknown";
  if (l[0] > c[0]) return "major";
  if (l[0] === c[0] && l[1] > c[1]) return "minor";
  if (l[0] === c[0] && l[1] === c[1] && l[2] > c[2]) return "patch";
  return "unknown";
}

/**
 * Run `npm outdated --json`. npm exits with code 1 when packages are outdated,
 * which is expected — we read stdout regardless. Empty output means everything
 * is up to date.
 */
export async function analyzeOutdated(
  project: ProjectInfo,
  opts: { prod?: boolean } = {},
): Promise<OutdatedResult> {
  if (!project.hasNodeModules) {
    return {
      deps: [],
      ran: false,
      note: "node_modules not found — run `npm install` first.",
    };
  }

  const args = ["outdated", "--json", "--long"];
  if (opts.prod) args.push("--omit=dev");

  let result;
  try {
    result = await runNpm(args, project.root);
  } catch (err) {
    return { deps: [], ran: false, note: (err as Error).message };
  }

  // No output at all: everything up to date.
  if (!result.stdout.trim()) {
    return { deps: [], ran: true };
  }

  const parsed = parseNpmJson<Record<string, NpmOutdatedEntry | NpmOutdatedEntry[]>>(
    result.stdout,
  );
  if (!parsed || typeof parsed !== "object") {
    return { deps: [], ran: true };
  }

  const deps: OutdatedDep[] = [];
  for (const [name, raw] of Object.entries(parsed)) {
    // npm may return an array if a package appears at multiple locations.
    const entry = Array.isArray(raw) ? raw[0] : raw;
    if (!entry) continue;

    const current = entry.current ?? "—";
    const wanted = entry.wanted ?? "—";
    const latest = entry.latest ?? "—";

    // Skip rows where there's genuinely nothing newer.
    if (current === latest && current !== "—") continue;

    const type =
      entry.type ??
      (name in project.devDependencies ? "devDependencies" : "dependencies");

    if (opts.prod && type === "devDependencies") continue;

    deps.push({
      name,
      current,
      wanted,
      latest,
      kind: classifyJump(current, latest),
      type,
    });
  }

  // Sort: major jumps first, then by name.
  const order: Record<OutdatedKind, number> = {
    major: 0,
    minor: 1,
    patch: 2,
    unknown: 3,
  };
  deps.sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name));

  return { deps, ran: true };
}

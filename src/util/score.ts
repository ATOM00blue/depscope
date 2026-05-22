import type {
  HealthScore,
  OutdatedResult,
  SizeResult,
  UnusedResult,
  VulnResult,
} from "../types.js";

interface ScoreInput {
  size?: SizeResult;
  outdated?: OutdatedResult;
  vulnerabilities?: VulnResult;
  unused?: UnusedResult;
  totalDeclaredDeps: number;
}

/**
 * Compute a 0–100 health score. Each dimension can deduct points; the result
 * is clamped to [0, 100]. Only dimensions that actually ran contribute.
 */
export function computeHealth(input: ScoreInput): HealthScore {
  let score = 100;
  const reasons: string[] = [];

  const v = input.vulnerabilities;
  if (v?.ran && v.total > 0) {
    const penalty =
      v.counts.critical * 20 +
      v.counts.high * 10 +
      v.counts.moderate * 4 +
      v.counts.low * 1;
    const capped = Math.min(penalty, 55);
    score -= capped;
    reasons.push(
      `${v.total} vulnerabilit${v.total === 1 ? "y" : "ies"} (-${capped})`,
    );
  }

  const o = input.outdated;
  if (o?.ran && o.deps.length > 0) {
    const major = o.deps.filter((d) => d.kind === "major").length;
    const minor = o.deps.filter((d) => d.kind === "minor").length;
    const penalty = Math.min(major * 3 + minor * 1, 25);
    if (penalty > 0) {
      score -= penalty;
      reasons.push(`${o.deps.length} outdated (-${penalty})`);
    }
  }

  const u = input.unused;
  if (u?.ran) {
    const unusedCount = u.unused.length + u.unusedDev.length;
    const penalty =
      Math.min(unusedCount * 2, 12) + Math.min(u.missing.length * 4, 16);
    if (penalty > 0) {
      score -= penalty;
      const bits: string[] = [];
      if (unusedCount) bits.push(`${unusedCount} unused`);
      if (u.missing.length) bits.push(`${u.missing.length} missing`);
      reasons.push(`${bits.join(", ")} (-${penalty})`);
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, grade: gradeFor(score), reasons };
}

function gradeFor(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

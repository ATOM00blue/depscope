import { spawn } from "node:child_process";

export interface NpmRunResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

/** The npm executable name, accounting for Windows (`npm.cmd`). */
export const NPM_BIN = process.platform === "win32" ? "npm.cmd" : "npm";

/**
 * Quote an argument for the Windows command line. Wraps in double quotes when
 * the value contains whitespace or shell metacharacters, escaping any embedded
 * quotes. Used with `windowsVerbatimArguments` so cmd.exe sees the literal
 * string we build.
 */
function quoteWinArg(arg: string): string {
  if (arg === "") return '""';
  if (!/[\s"&|<>^()]/.test(arg)) return arg;
  return '"' + arg.replace(/"/g, '""') + '"';
}

/**
 * Run an npm subcommand and capture output. npm commands like `outdated` and
 * `audit` exit non-zero when they find issues, so a non-zero code is NOT
 * treated as a hard failure here — the caller inspects stdout/code.
 */
export function runNpm(
  args: string[],
  cwd: string,
  timeoutMs = 120_000,
): Promise<NpmRunResult> {
  return new Promise((resolve, reject) => {
    const isWin = process.platform === "win32";
    // On Windows, npm is a .cmd shim. Rather than `shell:true` (which triggers
    // DEP0190 when args are passed), invoke cmd.exe directly with /d /s /c and
    // pass the whole command line as a single, manually-quoted string.
    const command = isWin ? "cmd.exe" : NPM_BIN;
    const spawnArgs = isWin
      ? ["/d", "/s", "/c", [NPM_BIN, ...args].map(quoteWinArg).join(" ")]
      : args;

    const child = spawn(command, spawnArgs, {
      cwd,
      windowsHide: true,
      windowsVerbatimArguments: isWin,
      env: { ...process.env, NO_UPDATE_NOTIFIER: "1", NPM_CONFIG_FUND: "false" },
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`npm ${args.join(" ")} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout?.on("data", (d) => (stdout += d.toString()));
    child.stderr?.on("data", (d) => (stderr += d.toString()));

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
  });
}

/**
 * Best-effort JSON parse of npm output. npm sometimes prepends warnings to
 * stdout; this finds the first `{` or `[` and parses from there.
 */
export function parseNpmJson<T>(stdout: string): T | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const firstBrace = trimmed.search(/[[{]/);
    if (firstBrace === -1) return null;
    try {
      return JSON.parse(trimmed.slice(firstBrace)) as T;
    } catch {
      return null;
    }
  }
}

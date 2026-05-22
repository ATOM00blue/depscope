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
 * Best-effort kill of the entire child process tree. On Windows the immediate
 * child is cmd.exe, which spawns npm, which spawns node — a plain `child.kill()`
 * only signals cmd.exe and can orphan the grandchildren. We use `taskkill /T`
 * to reap the whole subtree.
 */
function killTree(child: ReturnType<typeof spawn>): void {
  if (process.platform === "win32" && typeof child.pid === "number") {
    try {
      // Detached so killing it doesn't depend on our own stdio; ignore errors.
      spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        windowsHide: true,
      }).on("error", () => {});
    } catch {
      // fall through to child.kill below
    }
  }
  try {
    child.kill("SIGKILL");
  } catch {
    // already dead
  }
}

/**
 * Build the concrete command + argv for invoking an npm subcommand, applying
 * the security hardening (`--ignore-scripts`) and the Windows cmd.exe verbatim
 * quoting. Exported so the safety properties are unit-testable without spawning.
 */
export function buildNpmInvocation(
  args: string[],
  isWin = process.platform === "win32",
): { command: string; spawnArgs: string[]; verbatim: boolean } {
  // Defense-in-depth: refuse to run any project lifecycle scripts.
  const safeArgs = [...args, "--ignore-scripts"];
  const npmBin = isWin ? "npm.cmd" : "npm";
  // On Windows, npm is a .cmd shim. Rather than `shell:true` (which triggers
  // DEP0190 when args are passed), invoke cmd.exe directly with /d /s /c and
  // pass the whole command line as a single, manually-quoted string.
  if (isWin) {
    return {
      command: "cmd.exe",
      spawnArgs: ["/d", "/s", "/c", [npmBin, ...safeArgs].map(quoteWinArg).join(" ")],
      verbatim: true,
    };
  }
  return { command: npmBin, spawnArgs: safeArgs, verbatim: false };
}

/**
 * Child-process environment used for every npm invocation. Disables update
 * notifier / funding noise and — critically — forces `ignore-scripts` so that
 * nested npm processes can never execute lifecycle scripts of the analyzed
 * (untrusted) project.
 */
export function npmChildEnv(
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...base,
    NO_UPDATE_NOTIFIER: "1",
    NPM_CONFIG_FUND: "false",
    NPM_CONFIG_AUDIT: "false",
    // Belt-and-suspenders: nested npm processes also refuse scripts.
    NPM_CONFIG_IGNORE_SCRIPTS: "true",
  };
}

/**
 * Run an npm subcommand and capture output. npm commands like `outdated` and
 * `audit` exit non-zero when they find issues, so a non-zero code is NOT
 * treated as a hard failure here — the caller inspects stdout/code.
 *
 * Security: `--ignore-scripts` is appended to every invocation and
 * `NPM_CONFIG_IGNORE_SCRIPTS=true` is set in the child env, so depscope can
 * never execute lifecycle scripts of the analyzed (untrusted) project, even if
 * the npm subcommand or a nested npm process would otherwise do so.
 */
export function runNpm(
  args: string[],
  cwd: string,
  timeoutMs = 120_000,
): Promise<NpmRunResult> {
  return new Promise((resolve, reject) => {
    const isWin = process.platform === "win32";
    const { command, spawnArgs, verbatim } = buildNpmInvocation(args, isWin);

    const child = spawn(command, spawnArgs, {
      cwd,
      windowsHide: true,
      windowsVerbatimArguments: verbatim,
      env: npmChildEnv(),
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killTree(child);
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

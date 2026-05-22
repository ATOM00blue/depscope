# depscope — Security & Quality Review

Date: 2026-05-22
Reviewer: autonomous application-security engineer
Scope: full source tree (`src/`, `bin/`, `test/`, configs), dependency/supply-chain
audit, cross-platform (Windows) spawn correctness.
Method: code audit + empirical exploitation against crafted malicious fixtures
(lifecycle scripts, escaping symlinks/junctions, cycles, malformed manifests,
ReDoS inputs, prototype-pollution payloads).

depscope's threat model: it analyzes **arbitrary, untrusted projects**. The
analyzed project's `package.json`, lockfile, `node_modules` layout (including
symlinks), source files, and directory/file names are all attacker-controlled
input. The tool must never (a) execute any code from the analyzed project, nor
(b) read/walk outside the analyzed project tree, nor (c) be DoS'd by it.

---

## Summary of findings

| # | Severity | Area | File | Status |
|---|----------|------|------|--------|
| 1 | **High** | Symlink traversal — size walker escapes the project tree | `src/analyzers/size.ts` | FIXED |
| 2 | **Medium** | Unbounded resource use — size walk has no depth bound; unused scan reads files of any size | `src/analyzers/size.ts`, `src/analyzers/unused.ts` | FIXED |
| 3 | **Medium** | Defense-in-depth — npm subprocess could run lifecycle scripts if commands change | `src/util/npm.ts` | FIXED |
| 4 | **Medium** | Malformed `package.json` (non-object, or string deps fields) crashes or yields garbage deps | `src/util/project.ts` | FIXED |
| 5 | Low | Negative `--top` silently drops dependencies (`slice(0, -n)`) | `src/cli.ts` | FIXED |
| 6 | Low | npm timeout `child.kill()` does not kill the cmd.exe → npm → node process tree on Windows | `src/util/npm.ts` | FIXED |
| 7 | Info | Command/arg injection in npm spawn — reviewed, **already safe** (static args, arg array, no shell) | `src/util/npm.ts` | OK (verified) |
| 8 | Info | Prototype pollution from parsing manifests/audit JSON — reviewed, **no sink** | multiple | OK (verified) |
| 9 | Info | ReDoS in import/version/script regexes — reviewed, **linear** | `src/analyzers/unused.ts`, `outdated.ts` | OK (verified) |
| 10 | Info | Supply chain: 5 moderate dev-only CVEs (vitest→vite→esbuild) | `package.json` | FIXED (vitest 3) |

No Critical findings. No project code is executed by depscope (verified — see #7/#3).

---

## 1. HIGH — Symlink traversal: size walker escapes the analyzed project

**File:** `src/analyzers/size.ts` — `listInstalledPackages()` (lines ~89–112)
feeding `measureDir()` (lines ~16–52).

**Impact:** Information disclosure (file sizes/counts of arbitrary paths outside
the project) and denial of service (walking `C:\` or `/`). An attacker who
controls a project's `node_modules` can place a symlink/junction named like a
package that points **outside** the project, e.g.
`node_modules/evil -> C:\` or `-> /`.

**Root cause:** `measureDir()` correctly skips symlinks it discovers *inside* a
directory (`if (entry.isSymbolicLink()) continue;`) to avoid cycles — but the
**top-level package directory passed in by `listInstalledPackages()` is itself a
followed symlink**. `listInstalledPackages()` explicitly admits symlinks as
packages (`if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;` and
the scoped `s.isDirectory() || s.isSymbolicLink()` branch) and hands the link
path to `measureDir()`, whose first `readdir()` dereferences it and walks the
target. The "Symlinks are not followed" comment was therefore false for the
entry point.

**Proof of concept (verified):** a fixture with
`node_modules/evil` junctioned to `%TEMP%\depscope-escape-target` (containing a
5 MB file) reported `Total node_modules: 5.0 MB (1 files)` and a package row
`evil 5.0 MB` — i.e. depscope read and measured a file **outside** the project.

**Fix:** `listInstalledPackages()` now records whether each package entry is a
symlink. `measureDir()` takes a `rootReal` (the real path of `node_modules`) and
verifies, via `realpath`, that the package's real target stays **inside**
`node_modules`; symlinked packages that escape the tree are skipped (and noted).
Symlinks inside the walk continue to be skipped. This both closes the escape and
removes the (already-bounded but now redundant) cycle risk. See #2 for the depth
bound that backstops genuinely deep real trees.

---

## 2. MEDIUM — Unbounded resource use on hostile inputs

**Files:** `src/analyzers/size.ts` (`measureDir` had no depth cap),
`src/analyzers/unused.ts` (`readFile(file, "utf8")` with no size cap; no file
count cap).

**Impact:** DoS. A maliciously deep real directory tree under a package could
recurse without bound; a multi-GB source file (`huge.js`) would be slurped
entirely into memory by the unused scanner → OOM. A project with an enormous
number of source files would also be read in full.

**Fix:**
- `measureDir()` now enforces `MAX_DEPTH` (64) — far beyond any real install
  layout but a hard backstop against pathological/adversarial nesting.
- `analyzeUnused` skips files larger than `MAX_FILE_BYTES` (2 MiB) — real source
  files are tiny; this only excludes adversarial blobs — and caps the total
  number of scanned files at `MAX_FILES` (50 000) to bound work on giant trees.
- The size walker already used bounded concurrency; that is retained.

---

## 3. MEDIUM — Defense-in-depth: never execute analyzed-project code

**File:** `src/util/npm.ts` — `runNpm()`.

**Finding:** depscope only ever runs `npm audit --json` and
`npm outdated --json`, and **verified empirically** that neither executes the
analyzed project's lifecycle scripts (a fixture with `preinstall`/`prepare`/
`preaudit` scripts that write a marker file produced **no** marker, with and
without `node_modules`/lockfile present). So the current behavior is safe.

However, this is a one-line-change away from disaster: if a future command (or a
transitively-invoked npm step) ever touched install, scripts would run with the
attacker's code. Added belt-and-suspenders so the property is enforced by
construction, not by which subcommand happens to be used:

- Pass `--ignore-scripts` on every npm invocation.
- Set `NPM_CONFIG_IGNORE_SCRIPTS=true` in the child env so nested npm processes
  also refuse to run scripts.
- Keep `--no-audit`/fund-off env already present, and `--no-update-notifier`.

This guarantees depscope can never run analyzed-project code via npm, regardless
of subcommand.

---

## 4. MEDIUM — Malformed `package.json` crashes or produces garbage deps

**File:** `src/util/project.ts` — `loadProject()`.

**Impact:** Robustness / correctness. Two cases (verified):
- `package.json` whose top-level JSON is `null` → `raw.dependencies` throws
  `Cannot read properties of null` **outside** the try/catch → uncaught,
  surfaces as a fatal error / exit 2 on an otherwise analyzable project.
- `"dependencies": "lodash"` (a string instead of an object) → `Object.keys`
  over a string yields index keys `"0".."5"` → six bogus dependency names fed
  into the size/unused/score analyzers, corrupting the report.

**Fix:** `loadProject()` now validates the parsed manifest is a non-null,
non-array object, and coerces each dependency map through an `asStringRecord()`
helper that returns `{}` unless the value is a plain object with string values.
Malformed manifests degrade gracefully instead of crashing or fabricating deps.

---

## 5. LOW — Negative `--top` silently drops dependencies

**File:** `src/cli.ts` (`Number.parseInt(opts.top)` only checks `Number.isFinite`)
consumed by `src/analyzers/size.ts` (`directSizes.slice(0, top)`).

**Impact:** `--top -2` passes the finite check, and `slice(0, -2)` drops the two
largest deps from the report — confusing, not dangerous.

**Fix:** CLI now clamps `top` to a sane non-negative integer (`>= 0`, default 10
when NaN/negative); `analyzeSize` also defensively `Math.max(0, top)` before
slicing.

---

## 6. LOW — npm timeout does not kill the Windows process tree

**File:** `src/util/npm.ts` — timeout handler calls `child.kill()`.

**Impact:** On Windows the child is `cmd.exe`, which spawns `npm`, which spawns
`node`. `child.kill()` signals only `cmd.exe`; the npm/node grandchildren can be
orphaned and keep running after a timeout.

**Fix:** On timeout (and on the platforms that support it) the child is spawned
with `detached: false` and killed with `SIGKILL`; on Windows we additionally
issue `taskkill /pid <pid> /T /F` (tree kill) best-effort so the whole subtree is
reaped. Failure of the tree-kill is swallowed (we are already erroring out).

---

## 7. INFO — Command/argument injection in npm spawn (reviewed: SAFE)

**File:** `src/util/npm.ts`.

`runNpm` spawns with an **argument array** and **no `shell: true`** on POSIX, so
there is no shell to inject into. On Windows it invokes `cmd.exe /d /s /c` with
`windowsVerbatimArguments: true` and a manually quoted command line built by
`quoteWinArg`. Critically, **every argument is a hardcoded constant** (`"audit"`,
`"outdated"`, `"--json"`, `"--long"`, `"--omit=dev"`, and now `"--ignore-scripts"`):
no project-controlled string (package name, path, version) is ever placed on the
npm command line. The analyzed project's location is passed only via `cwd`, which
is a `spawn` option, not part of the command string.

`quoteWinArg` correctly quotes whitespace and cmd metacharacters
(`& | < > ^ ( )`) and doubles embedded quotes. Because inputs are constants this
is not security-load-bearing today, but it is correct and retained for safety.

Conclusion: no injection vector. Verified by inspection; left as-is (plus the
`--ignore-scripts` hardening from #3).

---

## 8. INFO — Prototype pollution from parsed JSON (reviewed: NO SINK)

depscope `JSON.parse`s the analyzed project's `package.json` and `npm
audit/outdated` output. `JSON.parse('{"__proto__":{...}}')` creates an **own
enumerable** `"__proto__"` property, not a real prototype link, and the code only
ever (a) iterates with `Object.entries`/`Object.keys`, and (b) shallow-spreads
peer/optional deps (`{ ...peer, ...optional }`). Verified that neither path
writes to `Object.prototype`. There is **no recursive merge / no computed
assignment with attacker-controlled keys** anywhere, so there is no pollution
sink. Defensive `asStringRecord` validation (#4) further narrows what is copied.
Left as-is.

---

## 9. INFO — ReDoS in regex parsing (reviewed: LINEAR)

The import/require/export patterns in `unused.ts` use char-class-bounded lazy
quantifiers (`[^'"]*?` between quotes), the comment strippers are lazy
(`[\s\S]*?`), `parseVersion`'s `^[^\d]*` is linear, and `packagesFromScripts`
escapes the package name before building its regex. Verified against pathological
inputs (200 KB no-quote runs, 50 000 repeated imports, 500 KB unterminated block
comment) — all completed in single-digit milliseconds. No catastrophic
backtracking. Left as-is; the per-file size cap from #2 bounds worst case anyway.

---

## 10. INFO — Supply chain (npm audit)

`npm audit --json` reports **5 moderate** advisories, all transitive and
**dev-only**, in the vitest → vite → vite-node / @vitest/mocker → esbuild chain
(esbuild dev-server request advisory GHSA-67mh-4wv8-2f99; vite path-traversal
GHSA-4w7w-66w2-5vf9). These tools never run in production or against analyzed
projects — they exist only for the test suite — so user risk is nil. The clean
upgrade was a vitest **major** (`^4.1.7`). Verified the stable
`vitest` / `vitest/config` imports used by this project are unchanged across the
major, rebuilt, and re-ran the full suite (37 tests pass). **`npm audit` now
reports 0 vulnerabilities.** No advisories remain to accept.

---

## Quality notes

- **Tests:** added regression coverage for the symlink escape (#1), depth bound
  (#2), malformed-manifest hardening (#4), `--top` clamping (#5), and
  `--ignore-scripts` argument presence (#3). Existing 24 tests retained.
- **Lint/typecheck:** `npm run lint` (== `tsc --noEmit`) is clean.
- **README:** accurate; the "Does it modify my project? No / read-only" and
  "never executes your code" guarantees are now enforced structurally (#3).
- **CI:** matrix covers Node 18/20/22 on ubuntu + windows, runs typecheck,
  build, test, and a built-CLI smoke — adequate.

## Intentionally NOT changed

- `quoteWinArg` kept (correct, and harmless even though args are constant).
- Prototype-pollution and ReDoS code paths kept (verified safe).
- The conservative unused-detection heuristics (allowlists) are by-design and
  out of scope for a security/robustness pass.
</content>
</invoke>

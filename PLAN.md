# depscope — Plan & Spec

> Instant dependency report for any npm project: install size, outdated, vulnerabilities, and unused deps in one command.

## Problem / Gap

Existing tools each do one slice:

| Tool | Unused/Missing | Outdated | Vulnerabilities | Install size | Status |
|------|:---:|:---:|:---:|:---:|---|
| depcheck | ✓ | ✗ | ✗ | ✗ | maintained |
| npm-check | ✓ | ✓ | ✗ | ✗ | unmaintained (2021) |
| cost-of-modules | ✗ | ✗ | ✗ | ✓ | niche |
| npm audit | ✗ | ✗ | ✓ | ✗ | built-in, noisy JSON |

**Nobody gives a single zero-config snapshot.** `npx depscope` does all four in one clean color table, plus `--json` for CI.

## MVP scope (must ship)

1. **Install size** — walk `node_modules`, compute per-top-level-dependency disk size and total. Report largest deps.
2. **Outdated** — parse `npm outdated --json`: current vs wanted vs latest, color-coded by semver gap (patch/minor/major).
3. **Vulnerabilities** — parse `npm audit --json` (npm v7+ schema): counts by severity + per-package detail. Handle `via` string|object.
4. **Unused & missing** — static analysis: scan source for `import`/`require`/dynamic import; compare against `package.json` deps. Flag declared-but-unused and used-but-undeclared. Respect known false positives (types, plugin configs, bin-only tools).
5. **Output** — clean color summary + tables (cli-table3 + chalk). `--json` machine output. Non-zero exit on findings via `--fail-on`.

## Standout features

- **Zero-config**: `npx depscope` in any project; auto-detect project root (nearest package.json).
- **Health score** (0–100) headline: weighted by vulns, outdated, unused, bloat.
- **Selective sections**: `--size`, `--outdated`, `--vuln`, `--unused` to run only some; default runs all.
- **Speed**: run npm subprocesses concurrently; size walk is async + parallel.
- **Cross-platform**: pure Node fs (no `du`), works on Windows. Resolve `npm` via `npm.cmd` on win32.
- **Graceful degradation**: missing node_modules → skip size/audit/outdated with a hint; never crash.
- **`--prod`** to ignore devDependencies; **`--depth`** for size detail; **`--top N`**.

## CLI design

```
npx depscope [path] [options]

Sections (default: all):
  --size           Install size analysis only
  --outdated       Outdated check only
  --vuln           Vulnerability audit only
  --unused         Unused/missing analysis only

Output:
  --json           Machine-readable JSON
  --no-color       Disable color
  --top <n>        Show top N largest deps (default 10)

Filters:
  --prod           Ignore devDependencies
  --fail-on <lvl>  Exit non-zero: vuln severity (low|moderate|high|critical),
                   or "any" finding. Default: never fail.

Misc:
  -v, --version    Print version
  -h, --help       Help
```

## Architecture / file layout

```
src/
  cli.ts                 # commander setup, flag parsing, orchestrates run
  index.ts               # public programmatic API (analyze())
  types.ts               # shared interfaces (Report, SizeResult, ...)
  analyzers/
    size.ts              # node_modules disk walk
    outdated.ts          # npm outdated --json
    vulnerabilities.ts   # npm audit --json
    unused.ts            # static import scan vs package.json
  util/
    project.ts           # find package.json / project root, read manifest
    npm.ts               # cross-platform npm spawn helper (npm.cmd on win)
    bytes.ts             # humanize bytes
    score.ts             # health score computation
  report/
    table.ts             # color table rendering
    json.ts              # json output shape
bin/
  depscope.js            # thin shim -> dist/cli.js (shebang)
test/
  *.test.ts              # vitest unit + e2e against fixtures
  fixtures/              # tiny sample projects
```

## Tech choices

- **commander** — arg parsing (standard, robust).
- **chalk** v5 (ESM) — color. (Project is ESM, `"type":"module"`.)
- **cli-table3** — tables.
- **vitest** — fast TS-native tests.
- **tsup** — bundle TS → ESM dist with shebang, fast.
- No runtime dep on the target project's tooling beyond `npm` (already present).

## Unused-detection strategy (keep it honest)

- Parse source files (.js/.jsx/.ts/.tsx/.mjs/.cjs) via regex + lightweight tokenization for `import ... from 'x'`, `require('x')`, `import('x')`, and re-exports.
- Resolve specifier to package name (handle scoped `@scope/name`, subpaths `pkg/sub`).
- Also scan config files (package.json scripts, eslint/prettier/babel keys) so config-only tools aren't false-flagged.
- Allowlist of common always-used patterns: `@types/*` matched to their base pkg, `typescript`, test runners, husky, etc. Conservative — better to under-report unused than nag wrongly.
- Missing = imported but not in deps/devDeps and not a Node builtin.

## Output exit codes

- 0 = ran fine (default, even with findings).
- With `--fail-on`: 1 if threshold met.
- 2 = usage / fatal error.

## Done criteria

- Builds clean, `npx depscope` renders against a real fixture (verified e2e).
- Unit tests for each analyzer + e2e smoke; CI green on Node 18/20/22.
- README with example output, flags, FAQ; MIT license; published public on GitHub.

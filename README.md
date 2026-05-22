# depscope

> Instant dependency report for any npm project — install size, outdated packages, vulnerabilities, and unused deps in **one command**.

[![npm version](https://img.shields.io/npm/v/depscope.svg?color=cb3837&logo=npm)](https://www.npmjs.com/package/depscope)
[![CI](https://github.com/ATOM00blue/depscope/actions/workflows/ci.yml/badge.svg)](https://github.com/ATOM00blue/depscope/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/node/v/depscope.svg)](https://nodejs.org)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

You already have `npm audit`, `npm outdated`, `depcheck`, and a calculator for
`du -sh node_modules`. **depscope runs all four at once** and prints a single,
readable health report — zero config, no install.

```bash
npx depscope
```

---

## Why depscope?

Existing tools each cover one slice of dependency health, and you have to wire
them together yourself:

| | Unused / missing | Outdated | Vulnerabilities | Install size |
|--------------------|:---:|:---:|:---:|:---:|
| `depcheck`         | ✅ | ❌ | ❌ | ❌ |
| `npm-check`        | ✅ | ✅ | ❌ | ❌ (unmaintained) |
| `cost-of-modules`  | ❌ | ❌ | ❌ | ✅ |
| `npm audit`        | ❌ | ❌ | ✅ | ❌ |
| **`depscope`**     | ✅ | ✅ | ✅ | ✅ |

One command. One snapshot. One health score.

## Quick start

No installation required — run it straight from npx in any npm project:

```bash
npx depscope
```

Point it at another project:

```bash
npx depscope ./packages/api
```

Or install it globally / as a dev dependency:

```bash
npm i -g depscope        # then: depscope
npm i -D depscope        # then: npx depscope
```

## Example output

```text
  depscope  v1.0.0  ·  my-app@2.3.0
  18 dependencies · 12 devDependencies

  Health  ██████████████░░░░░░  68/100  D
          5 vulnerabilities (-20)  ·  4 outdated (-12)

Vulnerabilities

  5 moderate
  ┌────────────────┬──────────┬──────────┬──────────────────────────────────┐
  │ Package        │ Severity │ Fix      │ Advisory                         │
  ├────────────────┼──────────┼──────────┼──────────────────────────────────┤
  │ vite           │ moderate │ breaking │ Vite path traversal in optimizer │
  │ esbuild        │ moderate │ breaking │ esbuild dev server SSRF          │
  └────────────────┴──────────┴──────────┴──────────────────────────────────┘
  Run `npm audit fix` to resolve.

Outdated

  ┌─────────────┬──────────┬──────────┬────────┬───────┐
  │ Package     │ Current  │ Wanted   │ Latest │ Jump  │
  ├─────────────┼──────────┼──────────┼────────┼───────┤
  │ commander   │ 12.1.0   │ 12.1.0   │ 14.0.3 │ major │
  │ typescript  │ 5.9.3    │ 5.9.3    │ 6.0.3  │ major │
  └─────────────┴──────────┴──────────┴────────┴───────┘

Install size

  Total node_modules: 64.6 MB (1,737 files)
  ┌──────────────────┬─────────┬───────┬──────────────────┐
  │ Package          │ Size    │ Files │ Share            │
  ├──────────────────┼─────────┼───────┼──────────────────┤
  │ typescript       │ 22.5 MB │ 132   │ ▉▉▉▉········ 35% │
  │ @types/node      │ 2.2 MB  │ 69    │ ············ 3%  │
  │ (+82 transitive) │ 37.6 MB │ 1,361 │ ▉▉▉▉▉▉▉····· 58% │
  └──────────────────┴─────────┴───────┴──────────────────┘

Unused & missing

  Unused dependencies: left-pad, moment
  Missing (used, not declared): express
```

## Health score

depscope distills everything into a single **0–100 score** (with an A–F grade)
so you can track dependency health over time or gate it in CI. Points are
deducted for vulnerabilities (weighted by severity), outdated packages
(weighted by semver jump), and unused/missing dependencies. Sections that
don't run don't affect the score.

## What it checks

- **Install size** — walks `node_modules` and reports total size plus a
  per-dependency breakdown with share bars. Transitive packages are summarized
  so you can see exactly where the megabytes go.
- **Outdated** — `current` vs `wanted` vs `latest`, color-coded by whether the
  update is a patch, minor, or major bump.
- **Vulnerabilities** — parses `npm audit` and groups by severity, showing
  whether each fix is available, breaking, or unavailable.
- **Unused & missing** — static analysis of your source (`import`, `require`,
  dynamic `import()`, re-exports) compared against `package.json`. Deliberately
  conservative: config-driven tools (eslint, prettier, babel, build tools) and
  `@types/*` packages are recognized, so you get signal, not noise.

## Usage

```text
npx depscope [path] [options]

Arguments:
  path               Path to the project (defaults to the current directory).
                     depscope walks up to find the nearest package.json.

Sections (default: run all):
  --size             Install-size analysis only
  --outdated         Outdated check only
  --vuln             Vulnerability audit only
  --unused           Unused/missing analysis only

Output:
  --json             Machine-readable JSON (great for CI)
  --no-color         Disable colored output
  --top <n>          Show the top N largest dependencies (default: 10)

Filters:
  --prod             Ignore devDependencies
  --fail-on <level>  Exit non-zero on findings:
                     low | moderate | high | critical | any

Misc:
  -v, --version      Print the version
  -h, --help         Show help
```

### Examples

```bash
# Full report for the current project
npx depscope

# Only audit + outdated, ignoring devDependencies
npx depscope --vuln --outdated --prod

# Save a JSON report for tooling / dashboards
npx depscope --json > depscope-report.json

# Fail CI if any high or critical vulnerability exists
npx depscope --fail-on high

# Show the 20 biggest dependencies
npx depscope --size --top 20
```

## Use in CI

`--fail-on` makes depscope a one-line dependency gate. By default depscope
**never** fails your build (exit 0) so it's safe to add anywhere; opt in to
failures explicitly:

```yaml
# .github/workflows/deps.yml
- run: npm ci
- run: npx depscope --fail-on high
```

Exit codes: `0` success · `1` `--fail-on` threshold met · `2` usage / fatal error.

## Programmatic API

depscope ships types and an `analyze()` function for building your own tooling:

```ts
import { analyze, renderTable, toJson } from "depscope";

const report = await analyze({ path: "./", prod: true });

console.log(report.health.score, report.health.grade);
console.log(report.vulnerabilities?.total);

// Render it yourself, or reuse the built-in renderers:
console.log(renderTable(report));
console.log(toJson(report));
```

## FAQ

**Does it modify my project?**
No. depscope is read-only. It reads `package.json` and `node_modules`, and runs
`npm outdated` / `npm audit` (which don't change anything).

**Do I need to run `npm install` first?**
For the **size**, **outdated**, and **vulnerability** sections, yes — they need
`node_modules` and a lockfile. The **unused/missing** section is pure static
analysis and works without installing. If `node_modules` is missing, depscope
skips those sections gracefully with a hint instead of crashing.

**Why is a dependency I use flagged as "unused"?**
depscope detects usage via `import`/`require`/`import()` and `package.json`
scripts. If a package is loaded in a way it can't see (e.g. an exotic config
loader), it may be flagged. It already allow-lists common config/CLI tools and
`@types/*`. Please open an issue with the case so the heuristics can improve.

**Does it support pnpm / yarn?**
The size and unused checks work with any layout. The outdated and vulnerability
checks shell out to `npm`, so they're most accurate on npm-managed projects.
Native pnpm/yarn support is on the roadmap.

**Is it fast?**
Yes — analyzers run concurrently and the size walk is parallelized. The slowest
part is `npm audit`/`outdated`, which depscope runs in parallel rather than
back-to-back.

## Contributing

Issues and PRs are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © 2026 ATOM00blue

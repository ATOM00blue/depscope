# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] - 2026-05-22

### Security

- **Symlink traversal containment (High):** the install-size walker no longer
  follows a package directory in `node_modules` that is a symlink/junction
  pointing outside the analyzed project. Previously a hostile project could make
  depscope read and measure files anywhere on disk (information disclosure / DoS).
  The walk is now confined to the real path of `node_modules` and is depth-bounded.
- **Never execute analyzed-project code (defense-in-depth):** every `npm`
  invocation now passes `--ignore-scripts` and runs with
  `NPM_CONFIG_IGNORE_SCRIPTS=true` in the child environment, guaranteeing that
  lifecycle scripts of the analyzed (untrusted) project can never run, regardless
  of subcommand or nested npm processes.
- **Resource bounds against hostile inputs:** the unused/missing scanner now
  skips files larger than 2 MiB, caps the number of scanned files, and never
  follows directory symlinks; the size walker is depth-bounded. These prevent
  out-of-memory and runaway-traversal denial of service.
- **Dependency CVEs:** upgraded `vitest` (dev dependency) to v4, clearing 5
  moderate transitive advisories in the vite/esbuild chain. `npm audit` now
  reports 0 vulnerabilities.

### Fixed

- **Malformed `package.json` robustness:** a manifest whose top-level value is
  `null`/array/string/number no longer crashes the run, and a non-object
  `dependencies` field (e.g. a string) no longer fabricates garbage dependency
  names. Only string-valued entries of plain-object dependency maps are kept.
- A negative `--top` value no longer silently drops the largest dependencies; it
  is clamped to a non-negative integer.
- On Windows, an `npm` subprocess that times out is now killed as a process tree
  (`taskkill /T`), preventing orphaned npm/node grandchildren.

[1.0.1]: https://github.com/ATOM00blue/depscope/releases/tag/v1.0.1

## [1.0.0] - 2026-05-22

### Added

- Initial release.
- **Install size** analysis: total `node_modules` size plus per-dependency
  breakdown with share bars and file counts.
- **Outdated** check via `npm outdated`, classified by semver jump
  (patch / minor / major).
- **Vulnerability** audit via `npm audit` (npm v7+ schema), summarized by
  severity with per-package fix availability.
- **Unused & missing** dependency detection through static import analysis,
  with conservative handling of config-driven and CLI tools.
- **Health score** (0–100 with letter grade) summarizing overall dependency
  health.
- `--json` output for CI and tooling.
- Section flags: `--size`, `--outdated`, `--vuln`, `--unused`.
- `--prod`, `--top <n>`, `--no-color`, and `--fail-on <level>` flags.
- Zero-config: `npx depscope` works in any npm project.
- Cross-platform support (Windows, macOS, Linux).

[1.0.0]: https://github.com/ATOM00blue/depscope/releases/tag/v1.0.0

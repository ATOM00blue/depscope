# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

# Contributing to depscope

Thanks for your interest in improving depscope! Contributions of all kinds are
welcome — bug reports, feature ideas, docs, and code.

## Getting started

```bash
git clone https://github.com/ATOM00blue/depscope.git
cd depscope
npm install
npm run build
```

Run the CLI locally against any project:

```bash
node bin/depscope.js /path/to/some/project
```

## Development workflow

| Command | What it does |
|---------|--------------|
| `npm run build` | Bundle TypeScript to `dist/` with tsup |
| `npm run dev` | Rebuild on change |
| `npm run typecheck` | Type-check without emitting |
| `npm test` | Run the full vitest suite |
| `npm run test:watch` | Watch mode |
| `npm run smoke` | Run the built CLI against the sample fixture |

The codebase is structured as:

```
src/
  cli.ts                 # commander setup + orchestration
  index.ts               # programmatic API: analyze()
  types.ts               # shared interfaces
  analyzers/             # size, outdated, vulnerabilities, unused
  util/                  # npm spawn, project resolution, bytes, score
  report/                # table + json renderers
test/
  *.test.ts              # unit + e2e
  fixtures/              # sample projects
```

## Guidelines

- **TypeScript, strict mode.** Keep `npm run typecheck` clean.
- **Add tests.** Pure logic gets a unit test; behavior touching `npm` or the
  filesystem gets coverage in `test/e2e.test.ts` against a fixture.
- **Stay cross-platform.** No shelling out to `du`, `grep`, etc. Use Node's
  `fs`. The `runNpm` helper already handles Windows.
- **Be conservative with "unused".** False positives are worse than false
  negatives here — nobody wants a tool that nags about deps they actually need.
- Keep dependencies minimal.

## Submitting changes

1. Fork and create a feature branch.
2. Make your change with tests.
3. Ensure `npm run typecheck && npm test && npm run build` all pass.
4. Open a pull request describing the change and motivation.

## Reporting bugs

Open an issue with:

- depscope version (`npx depscope --version`) and Node version.
- The command you ran and what happened vs. what you expected.
- If possible, a minimal `package.json` that reproduces it.

By contributing you agree your contributions are licensed under the MIT License.

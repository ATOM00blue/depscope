#!/usr/bin/env node
// Thin launcher so `npx depscope` and the global bin both work cross-platform.
// All logic lives in the compiled ESM entry under dist/.
import("../dist/cli.js").catch((err) => {
  // eslint-disable-next-line no-console
  console.error("depscope failed to start:", err?.message ?? err);
  process.exit(2);
});

import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    cli: "src/cli.ts",
    index: "src/index.ts",
  },
  format: ["esm"],
  target: "node18",
  platform: "node",
  dts: true,
  clean: true,
  sourcemap: false,
  splitting: false,
  shims: true,
});

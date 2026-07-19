import esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["tests/e2e/harness.ts"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  alias: { obsidian: "./tests/e2e/obsidian-shim.ts" },
  outfile: "tests/e2e/harness.js",
  sourcemap: false,
  logLevel: "info"
});

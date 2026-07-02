import esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["tests/e2e/harness.ts"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  outfile: "tests/e2e/harness.js",
  sourcemap: false,
  logLevel: "info"
});

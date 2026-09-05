import esbuild from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const mode = process.argv[2] ?? "production";
const isProd = mode === "production";
const watch = process.argv.includes("--watch");
const outdir = path.join(process.cwd(), "dist", "desktop");
const traceinkOutdir = path.join(outdir, "skills", "traceink");

const common = {
  bundle: true,
  sourcemap: !isProd,
  logLevel: "info",
  target: "es2022",
  define: {
    "process.env.NODE_ENV": JSON.stringify(isProd ? "production" : "development")
  }
};

await fs.mkdir(outdir, { recursive: true });
await fs.rm(path.join(outdir, "structured-today-spike.js"), { force: true });
await fs.mkdir(path.join(traceinkOutdir, "references"), { recursive: true });
await Promise.all([
  fs.copyFile("app/desktop/index.html", path.join(outdir, "index.html")),
  fs.copyFile("app/desktop/renderer.css", path.join(outdir, "renderer.css")),
  fs.copyFile("app/desktop/assets/app-icon.png", path.join(outdir, "app-icon.png")),
  fs.copyFile("app/desktop/assets/app-icon.icns", path.join(outdir, "app-icon.icns")),
  fs.copyFile("skills/traceink/SKILL.md", path.join(traceinkOutdir, "SKILL.md")),
  fs.copyFile(
    "skills/traceink/references/editorial-contract.md",
    path.join(traceinkOutdir, "references", "editorial-contract.md")
  )
]);

const rootPackage = JSON.parse(await fs.readFile("package.json", "utf8"));
await fs.writeFile(
  path.join(outdir, "package.json"),
  `${JSON.stringify(
    {
      name: "work-continuity",
      version: rootPackage.version,
      description: rootPackage.description,
      main: "main.js",
      type: "module",
      author: rootPackage.author,
      license: rootPackage.license
    },
    null,
    2
  )}\n`
);

const contexts = await Promise.all([
  esbuild.context({
    ...common,
    entryPoints: ["app/desktop/main.ts"],
    outfile: path.join(outdir, "main.js"),
    platform: "node",
    format: "esm",
    external: ["electron"]
  }),
  esbuild.context({
    ...common,
    entryPoints: ["app/desktop/preload.ts"],
    outfile: path.join(outdir, "preload.cjs"),
    platform: "node",
    format: "cjs",
    external: ["electron"]
  }),
  esbuild.context({
    ...common,
    entryPoints: ["app/desktop/renderer.tsx"],
    outfile: path.join(outdir, "renderer.js"),
    platform: "browser",
    format: "iife",
    jsx: "automatic"
  })
]);

if (watch) {
  await Promise.all(contexts.map((context) => context.watch()));
  console.log("[agent-whiteboard] watching desktop sources");
} else {
  await Promise.all(contexts.map((context) => context.rebuild()));
  await Promise.all(contexts.map((context) => context.dispose()));
}

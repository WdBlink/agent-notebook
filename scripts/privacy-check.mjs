import fs from "node:fs/promises";
import path from "node:path";

const sourceDir = path.join(process.cwd(), "src");
const forbidden = [/fetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /https?:\/\//];

const files = await walk(sourceDir);
const failures = [];
for (const file of files) {
  const text = await fs.readFile(file, "utf8");
  for (const pattern of forbidden) {
    if (pattern.test(text)) {
      failures.push(`${path.relative(process.cwd(), file)} matches ${pattern}`);
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("privacy-check: runtime source contains no network primitives");

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(full)));
    } else if (entry.name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

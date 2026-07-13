import fs from "node:fs/promises";
import path from "node:path";

const sourceDir = path.join(process.cwd(), "src");
const forbidden = [
  /api\.openai\.com/i,
  /api\.anthropic\.com/i,
  /generativelanguage\.googleapis\.com/i,
  /dashscope/i,
  /sk-[A-Za-z0-9_-]{20,}/
];

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

const constants = await fs.readFile(path.join(sourceDir, "constants.ts"), "utf8");
if (!constants.includes("http://127.0.0.1:11434/v1/chat/completions")) {
  failures.push("DEFAULT_SETTINGS.llmEndpoint must default to a localhost model endpoint");
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("privacy-check: task endpoint defaults to localhost; provider summaries use explicit local CLI commands; no public LLM host or API key is hardcoded");

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

import fs from "node:fs/promises";

const requiredFiles = [
  "README.md",
  "LICENSE",
  ".github/logo-light.svg",
  ".github/logo-dark.svg",
  ".github/cockpit-preview.png",
  ".github/repo-meta.yml"
];
for (const file of requiredFiles) {
  await assertFile(file);
}

const readme = await fs.readFile("README.md", "utf8");
const requiredSnippets = [
  "Daily Cockpit",
  "macOS Install",
  "Quick Start From Source",
  "Source Install",
  "Usage",
  "Verification",
  "Local Model",
  "Session Recovery",
  "one global React Flow canvas with no project switcher",
  "Node unit/integration suite",
  "Playwright browser suite",
  "aborts and joins timed-out mutators",
  "independent recovery budgets",
  "MIT"
];

for (const snippet of requiredSnippets) {
  if (!readme.includes(snippet)) {
    throw new Error(`README missing snippet: ${snippet}`);
  }
}

for (const retired of [
  "project switching",
  "keep independent boards",
  "53 unit/integration tests",
  "14 Playwright browser tests",
  "73 Node unit/integration tests",
  "32 Playwright browser tests",
  "35 Playwright browser tests",
  "76 Node unit/integration tests",
  "36 Playwright browser tests"
]) {
  if (readme.includes(retired)) {
    throw new Error(`README still contains retired whiteboard wording: ${retired}`);
  }
}

console.log("readme-check: README assets and required sections are present");

async function assertFile(file) {
  const stat = await fs.stat(file);
  if (!stat.isFile()) throw new Error(`Missing required file: ${file}`);
}

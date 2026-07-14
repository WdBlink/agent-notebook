import fs from "node:fs/promises";

const requiredFiles = ["README.md", "LICENSE", ".github/logo-light.svg", ".github/logo-dark.svg", ".github/repo-meta.yml"];
for (const file of requiredFiles) {
  await assertFile(file);
}

const readme = await fs.readFile("README.md", "utf8");
const requiredSnippets = [
  "Daily Cockpit",
  "Quick Start",
  "Install",
  "Usage",
  "Verification",
  "Local Model",
  "Hot Start",
  "MIT"
];

for (const snippet of requiredSnippets) {
  if (!readme.includes(snippet)) {
    throw new Error(`README missing snippet: ${snippet}`);
  }
}

console.log("readme-check: README assets and required sections are present");

async function assertFile(file) {
  const stat = await fs.stat(file);
  if (!stat.isFile()) throw new Error(`Missing required file: ${file}`);
}

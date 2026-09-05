import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

test("desktop and legacy client share the Agent Notebook product identity", async () => {
  const pkg = JSON.parse(await fs.readFile("package.json", "utf8"));
  const built = JSON.parse(await fs.readFile("dist/desktop/package.json", "utf8"));
  const manifest = JSON.parse(await fs.readFile("manifest.json", "utf8"));
  assert.equal(pkg.name, "agent-notebook");
  assert.equal(built.name, pkg.name);
  assert.equal(built.version, pkg.version);
  assert.equal(pkg.build.productName, "Agent Notebook");
  assert.equal(pkg.build.appId, "com.wdblink.agentnotebook");
  assert.equal(manifest.id, pkg.name);
  assert.equal(manifest.name, pkg.build.productName);
  assert.equal(pkg.build.mac.artifactName, "agent-notebook-${version}-macos-${arch}.${ext}");
  const main = await fs.readFile("app/desktop/main.ts", "utf8");
  assert.ok(main.includes('app.setName("Agent Notebook")'));
  assert.ok(main.includes('title: "Agent Notebook"'));
  assert.ok(main.includes("AGENT_NOTEBOOK_STRUCTURED_TODAY"));
  assert.doesNotMatch(main, /WORK_CONTINUITY_|DAILY_COCKPIT_/);
  const html = await fs.readFile("app/desktop/index.html", "utf8");
  assert.match(html, /<title>Agent Notebook<\/title>/);
});

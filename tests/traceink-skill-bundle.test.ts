import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  TRACEINK_EDITORIAL_CONTRACT_SHA256,
  TRACEINK_SKILL_BUNDLE_VERSION,
  TRACEINK_SKILL_PACKAGE_ID,
  TRACEINK_SKILL_SHA256,
  TraceinkSkillBundleError,
  loadTraceinkSkillBundle
} from "../src/traceink-skill-bundle";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CANONICAL_SKILL_PATH = path.join(REPOSITORY_ROOT, "skills", "traceink", "SKILL.md");
const CANONICAL_EDITORIAL_CONTRACT_PATH = path.join(
  REPOSITORY_ROOT,
  "skills",
  "traceink",
  "references",
  "editorial-contract.md"
);

test("loads the canonical development bundle as exact text with pinned lowercase SHA-256 provenance", async () => {
  const [bundle, skillText, editorialContractText] = await Promise.all([
    loadTraceinkSkillBundle(),
    readFile(CANONICAL_SKILL_PATH, "utf8"),
    readFile(CANONICAL_EDITORIAL_CONTRACT_PATH, "utf8")
  ]);

  assert.equal(bundle.packageId, TRACEINK_SKILL_PACKAGE_ID);
  assert.equal(bundle.packageId, "traceink");
  assert.equal(bundle.version, TRACEINK_SKILL_BUNDLE_VERSION);
  assert.equal(bundle.version, "traceink-skill-bundle-v1");
  assert.equal(bundle.skillText, skillText);
  assert.equal(bundle.editorialContractText, editorialContractText);
  assert.equal(bundle.skillHash, TRACEINK_SKILL_SHA256);
  assert.equal(bundle.editorialContractHash, TRACEINK_EDITORIAL_CONTRACT_SHA256);
  assert.match(bundle.skillHash, /^[a-f0-9]{64}$/);
  assert.match(bundle.editorialContractHash, /^[a-f0-9]{64}$/);
});

test("loads the byte-identical bundle copied beside the packaged desktop module", async () => {
  const packagedModuleUrl = pathToFileURL(path.join(REPOSITORY_ROOT, "dist", "desktop", "main.js"));
  const [bundle, packagedSkill, packagedEditorialContract, canonicalSkill, canonicalEditorialContract] = await Promise.all([
    loadTraceinkSkillBundle(packagedModuleUrl),
    readFile(path.join(REPOSITORY_ROOT, "dist", "desktop", "skills", "traceink", "SKILL.md")),
    readFile(path.join(REPOSITORY_ROOT, "dist", "desktop", "skills", "traceink", "references", "editorial-contract.md")),
    readFile(CANONICAL_SKILL_PATH),
    readFile(CANONICAL_EDITORIAL_CONTRACT_PATH)
  ]);

  assert.deepEqual(packagedSkill, canonicalSkill);
  assert.deepEqual(packagedEditorialContract, canonicalEditorialContract);
  assert.equal(bundle.skillText, canonicalSkill.toString("utf8"));
  assert.equal(bundle.editorialContractText, canonicalEditorialContract.toString("utf8"));
});

test("fails closed when the application-adjacent bundle is absent even if a user-installed bundle exists", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "traceink-bundle-missing-"));
  const packagedRoot = path.join(root, "packaged");
  const userBundleRoot = path.join(root, "user-home", ".codex", "skills", "traceink");
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = path.join(root, "user-home", ".codex");
  context.after(async () => {
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
    await rm(root, { recursive: true, force: true });
  });
  await copyCanonicalBundle(userBundleRoot);

  await assert.rejects(
    loadTraceinkSkillBundle(pathToFileURL(path.join(packagedRoot, "main.js"))),
    (error: unknown) => error instanceof TraceinkSkillBundleError && error.code === "bundle_missing"
  );
});

test("fails closed when either bundled canonical file does not match its pinned hash", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "traceink-bundle-mismatch-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  for (const [index, relativePath] of ["SKILL.md", path.join("references", "editorial-contract.md")].entries()) {
    const packagedRoot = path.join(root, `packaged-${index}`);
    const bundleRoot = path.join(packagedRoot, "skills", "traceink");
    await copyCanonicalBundle(bundleRoot);
    await writeFile(path.join(bundleRoot, relativePath), "tampered\n", "utf8");

    await assert.rejects(
      loadTraceinkSkillBundle(pathToFileURL(path.join(packagedRoot, "main.js"))),
      (error: unknown) =>
        error instanceof TraceinkSkillBundleError &&
        error.code === "bundle_integrity_mismatch" &&
        error.message.includes(path.basename(relativePath))
    );
  }
});

async function copyCanonicalBundle(destination: string): Promise<void> {
  await mkdir(path.join(destination, "references"), { recursive: true });
  const [skill, editorialContract] = await Promise.all([
    readFile(CANONICAL_SKILL_PATH),
    readFile(CANONICAL_EDITORIAL_CONTRACT_PATH)
  ]);
  await Promise.all([
    writeFile(path.join(destination, "SKILL.md"), skill),
    writeFile(path.join(destination, "references", "editorial-contract.md"), editorialContract)
  ]);
}

import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { NodeSqliteSaver } from "../src/langgraph-node-sqlite-checkpointer.ts";

// Explicit offline operation. Run via node --import tsx; no cleanup of provider stores.
const directory = process.argv[2];
if (!directory || !process.argv.includes("--apply")) throw new Error("Usage: node --import tsx scripts/maintain-checkpoints.mjs <user-data-directory> --apply");
const root = await fs.realpath(directory);
const databasePath = path.join(root, "structured-today-workflows-v1.sqlite");
const assetsPath = path.join(root, "traceink-assets-v1.json");
const assets = await fs.readFile(assetsPath);
const document = JSON.parse(assets.toString("utf8"));
if (!Array.isArray(document.structuredRuns)) throw new Error("Expected the Structured Today asset store.");
const paths = [];
for (const suffix of ["", "-wal", "-shm"]) {
  const file = databasePath + suffix;
  try { await fs.stat(file); paths.push(file); } catch (error) { if (error.code !== "ENOENT") throw error; }
}
const owners = spawnSync("lsof", ["-t", ...paths], { encoding: "utf8" });
if (owners.error || (owners.status !== 0 && owners.status !== 1)) throw new Error("Cannot verify database ownership.");
if (owners.stdout.trim()) throw new Error("Close Work Continuity and other checkpoint readers before offline maintenance.");
const before = (await fs.stat(databasePath)).size;
const space = await fs.statfs(root);
if (space.bavail * space.bsize < before * 2 + 100 * 1024 * 1024) throw new Error("Insufficient free space for recovery copy and SQLite compaction.");
const backup = await fs.mkdtemp(path.join(root, "checkpoint-recovery-"));
await fs.chmod(backup, 0o700);
for (const file of paths) await fs.copyFile(file, path.join(backup, path.basename(file)));
await fs.copyFile(assetsPath, path.join(backup, path.basename(assetsPath)));
const saver = NodeSqliteSaver.fromConnectionString(databasePath);
let removed;
try {
  removed = await saver.prune(document.structuredRuns.filter((run) => run.status === "ready").map((run) => run.runId));
} finally { saver.close(); }
const db = new DatabaseSync(databasePath);
try {
  db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA auto_vacuum=INCREMENTAL; VACUUM;");
  if (Object.values(db.prepare("PRAGMA integrity_check").get())[0] !== "ok") throw new Error("SQLite integrity check failed; recovery copy retained.");
} finally { db.close(); }
if (!(await fs.readFile(assetsPath)).equals(assets)) throw new Error("Artifact store changed during maintenance; recovery copy retained.");
// Keep a compressed, explicit recovery copy without leaving another multi-GB loose database.
execFileSync("gzip", ["--", path.join(backup, path.basename(databasePath))]);
const receipt = {
  beforeBytes: before, afterBytes: (await fs.stat(databasePath)).size,
  removedThreads: removed, artifactSha256: createHash("sha256").update(assets).digest("hex"),
  backup, integrity: "ok"
};
console.log(JSON.stringify(receipt, null, 2));

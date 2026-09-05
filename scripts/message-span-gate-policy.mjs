#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { tsImport } from "tsx/esm/api";

const { buildMessageSpanEligibilityPolicy } = await tsImport("../src/message-span-gate.ts", import.meta.url);

try {
  const options = parseArguments(process.argv.slice(2), ["--arm", "--asset-store", "--out"]);
  const policy = buildMessageSpanEligibilityPolicy(
    await fs.readFile(path.resolve(options["--arm"])),
    await fs.readFile(path.resolve(options["--asset-store"]))
  );
  const outputPath = path.resolve(options["--out"]);
  await writeFrozen(outputPath, policy);
  process.stdout.write(`${outputPath}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

function parseArguments(args, names) {
  const allowed = new Set(names);
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!allowed.has(name) || typeof value !== "string" || value.startsWith("--") || values[name]) throw new Error(usage());
    values[name] = value;
  }
  if (names.some((name) => !values[name]?.trim())) throw new Error(usage());
  return values;
}

async function writeFrozen(outputPath, value) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  await fs.writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
}

function usage() {
  return "Usage: node scripts/message-span-gate-policy.mjs --arm <arm.json> --asset-store <store.json> --out <policy.json>";
}

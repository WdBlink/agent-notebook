#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { tsImport } from "tsx/esm/api";

const { detectMessageSpanGateTrigger } = await tsImport("../src/message-span-gate.ts", import.meta.url);

try {
  const options = parseArguments(process.argv.slice(2));
  const result = detectMessageSpanGateTrigger({
    armBytes: await fs.readFile(path.resolve(options.arm)),
    policyBytes: await fs.readFile(path.resolve(options.policy)),
    assetStoreBytes: await fs.readFile(path.resolve(options.assetStore))
  });
  if (result.status === "waiting") {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else {
    const outputPath = path.resolve(options.out);
    await writeFrozen(outputPath, result.trigger);
    process.stdout.write(`${outputPath}\n`);
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

function parseArguments(args) {
  const allowed = new Set(["--arm", "--policy", "--asset-store", "--out"]);
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!allowed.has(name) || typeof value !== "string" || value.startsWith("--") || values.has(name)) throw new Error(usage());
    values.set(name, value);
  }
  for (const name of allowed) if (!values.get(name)?.trim()) throw new Error(usage());
  return { arm: values.get("--arm"), policy: values.get("--policy"), assetStore: values.get("--asset-store"), out: values.get("--out") };
}

async function writeFrozen(outputPath, value) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  await fs.writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
}

function usage() {
  return "Usage: node scripts/message-span-gate-trigger.mjs --arm <arm.json> --policy <policy.json> --asset-store <store.json> --out <trigger.json>";
}

#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { tsImport } from "tsx/esm/api";

const { sampleFormalMessageSpanGate } = await tsImport("../src/message-span-gate.ts", import.meta.url);

try {
  const options = parseArguments(process.argv.slice(2));
  const sample = sampleFormalMessageSpanGate({
    policyBytes: await fs.readFile(path.resolve(options.policy)),
    triggerBytes: await fs.readFile(path.resolve(options.trigger)),
    inventoryBytes: await fs.readFile(path.resolve(options.inventory)),
    eligibilityResultBytes: await fs.readFile(path.resolve(options.eligibility)),
    reviewerABytes: await fs.readFile(path.resolve(options.reviewA)),
    reviewerBBytes: await fs.readFile(path.resolve(options.reviewB))
  });
  const outputPath = path.resolve(options.out);
  await writeFrozen(outputPath, sample);
  process.stdout.write(`${outputPath}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

function parseArguments(args) {
  const names = ["--policy", "--trigger", "--inventory", "--eligibility", "--review-a", "--review-b", "--out"];
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index]; const value = args[index + 1];
    if (!names.includes(name) || typeof value !== "string" || value.startsWith("--") || values.has(name)) throw new Error(usage());
    values.set(name, value);
  }
  for (const name of names) if (!values.get(name)?.trim()) throw new Error(usage());
  return {
    policy: values.get("--policy"), trigger: values.get("--trigger"), inventory: values.get("--inventory"),
    eligibility: values.get("--eligibility"), reviewA: values.get("--review-a"), reviewB: values.get("--review-b"),
    out: values.get("--out")
  };
}

async function writeFrozen(outputPath, value) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  await fs.writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
}

function usage() {
  return "Usage: node scripts/message-span-gate-formal-sample.mjs --policy <policy.json> --trigger <trigger.json> --inventory <inventory.json> --eligibility <result.json> --review-a <a.json> --review-b <b.json> --out <sample.json>";
}

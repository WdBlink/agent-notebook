#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { tsImport } from "tsx/esm/api";

const { adjudicateMessageSpanGateFiles } = await tsImport("../src/message-span-gate.ts", import.meta.url);

try {
  const options = parseArguments(process.argv.slice(2));
  const receipt = adjudicateMessageSpanGateFiles({
    packPath: path.resolve(options.pack),
    reviewerAPath: path.resolve(options.reviewA),
    reviewerBPath: path.resolve(options.reviewB)
  });
  const outputPath = path.resolve(options.out);
  await fs.mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  await fs.writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx"
  });
  process.stdout.write(`${outputPath}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

function parseArguments(args) {
  const allowed = new Set(["--pack", "--review-a", "--review-b", "--out"]);
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!allowed.has(name) || typeof value !== "string" || value.startsWith("--")) {
      throw new Error(usage());
    }
    if (values.has(name)) throw new Error(`Duplicate option ${name}.\n${usage()}`);
    values.set(name, value);
  }
  for (const name of allowed) {
    if (!values.get(name)?.trim()) throw new Error(`Missing required option ${name}.\n${usage()}`);
  }
  return {
    pack: values.get("--pack"),
    reviewA: values.get("--review-a"),
    reviewB: values.get("--review-b"),
    out: values.get("--out")
  };
}

function usage() {
  return "Usage: node scripts/message-span-gate-adjudicate.mjs --pack <gate.json> " +
    "--review-a <review-a.json> --review-b <review-b.json> --out <receipt.json>";
}

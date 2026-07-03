import process from "node:process";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";

const args = process.argv.slice(2);
const vault = await resolveVault(args);

await run("npm", ["run", "build"]);
await run("node", ["scripts/install-local.mjs", "--vault", vault]);
await run("node", ["scripts/verify-local.mjs", "--vault", vault]);
await run("node", ["scripts/e2e-obsidian.mjs", "--vault", vault]);

async function resolveVault(cliArgs) {
  const explicit = readArg(cliArgs, "--vault") ?? process.env.OBSIDIAN_VAULT;
  if (explicit) return path.resolve(explicit);

  const configPath = path.join(process.env.HOME ?? "", "Library/Application Support/obsidian/obsidian.json");
  const config = JSON.parse(await fs.readFile(configPath, "utf8"));
  const openVault = Object.values(config.vaults ?? {}).find((vaultConfig) => vaultConfig?.open && vaultConfig?.path);
  const fallbackVault = Object.values(config.vaults ?? {}).find((vaultConfig) => vaultConfig?.path);
  const vaultPath = openVault?.path ?? fallbackVault?.path;
  if (!vaultPath) throw new Error("Could not resolve an Obsidian vault. Pass --vault /path/to/vault.");
  return path.resolve(vaultPath);
}

function readArg(cliArgs, name) {
  const index = cliArgs.indexOf(name);
  return index >= 0 ? cliArgs[index + 1] : undefined;
}

function run(command, commandArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: process.cwd(),
      stdio: "inherit"
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${commandArgs.join(" ")} exited with ${code}`));
      }
    });
  });
}

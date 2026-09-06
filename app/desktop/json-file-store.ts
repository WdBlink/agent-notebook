import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const writes = new Map<string, Promise<void>>();

export async function readJsonFile(filePath: string, missing: () => unknown): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return missing();
    throw new Error(`无法读取本地数据 ${filePath}；原文件已保留。`, { cause: error });
  }
}

export function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  const write = (writes.get(filePath) ?? Promise.resolve()).then(async () => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, serialized, { encoding: "utf8", flag: "wx", mode: 0o600 });
      await fs.rename(temporary, filePath);
    } finally {
      await fs.rm(temporary, { force: true });
    }
  });
  const settled = write.catch(() => undefined);
  writes.set(filePath, settled);
  void settled.then(() => { if (writes.get(filePath) === settled) writes.delete(filePath); });
  return write;
}

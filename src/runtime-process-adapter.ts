import { execFile, spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { CompanionProcess, ProcessAdapter } from "./runtime-gateway";

const execFileAsync = promisify(execFile);

export function createNodeProcessAdapter(): ProcessAdapter {
  return {
    spawn(command, args, options) {
      return spawn(command, [...args], options) as ChildProcess as CompanionProcess;
    },
    async membershipPids(hostPath, key, token, deadline) {
      const timeout = Math.min(750, deadline - Date.now());
      if (timeout <= 0) throw new Error("Runtime membership audit deadline elapsed.");
      const helper = path.join(path.dirname(hostPath), "process-membership");
      const { stdout } = await execFileAsync(helper, [], {
        env: { AGENT_NOTEBOOK_AUDIT_KEY: key, AGENT_NOTEBOOK_AUDIT_VALUE: token },
        timeout,
        maxBuffer: 1024 * 1024
      });
      return stdout.split("\n").filter(Boolean).map((line) => {
        if (!/^\d+$/.test(line)) throw new Error("Runtime membership audit returned invalid data.");
        return Number(line);
      });
    },
    signalPid(pid, signal) {
      try { process.kill(pid, signal); } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== "ESRCH") throw error;
      }
    }
  };
}

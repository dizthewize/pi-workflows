import { executeWorkflow } from "./executor.js";
import { AgentConfig, SingleResult } from "../types.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { describe, it, expect } from "vitest";

function mkTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function rmTmpDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe("executeWorkflow", () => {
  it("validates and fails on cyclic task graph", async () => {
    const tmp = mkTmpDir("exec-test-");
    try {
      const result = await executeWorkflow({
        name: "cyclic",
        tasks: [
          { id: "a", prompt: "1", dependsOn: ["b"] },
          { id: "b", prompt: "2", dependsOn: ["a"] },
        ],
        options: { maxCost: 10, reserveFiles: false },
        runtime: { cwd: tmp },
      });
      expect(result.status).toBe("failed");
      expect(result.tasks.some((t) => t.status === "pending")).toBe(true);
    } finally {
      rmTmpDir(tmp);
    }
  });

  it("executes a simple parallel workflow with mock agents", async () => {
    const tmp = mkTmpDir("exec-test-");
    try {
      const spawnFn = async () => ({
        agent: "mock",
        agentSource: "test",
        task: "test",
        exitCode: 0,
        messages: [],
        stderr: "",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0.10, contextTokens: 0, turns: 1 },
        output: "done",
      } as SingleResult);

      const result = await executeWorkflow({
        name: "simple",
        tasks: [
          { id: "t1", prompt: "Create types", files: ["src/types.ts"] },
          { id: "t2", prompt: "Create utils", files: ["src/utils.ts"] },
        ],
        options: { maxCost: 10, reserveFiles: true, autoApproveGates: true },
        runtime: { cwd: tmp },
        spawnFn,
      });

      expect(result.status).toBe("complete");
      expect(result.workflow.taskCount).toBe(2);
      expect(result.waves.length).toBe(1);
      expect(result.tasks[0].status).toBe("complete");
      expect(result.tasks[1].status).toBe("complete");
      expect(result.cost.total).toBe(0.20); // 2 × 0.10
    } finally {
      rmTmpDir(tmp);
    }
  });

  it("enforces cost limit across waves", async () => {
    const tmp = mkTmpDir("exec-test-");
    try {
      // Each task costs $3. Budget is $5.
      // Tasks chained: t1 -> t2 -> t3 (sequential waves).
      // Wave 0: t1 completes, cost=3 (under). Wave 1: t2 runs, cost=6 (over).
      // Before wave 2 starts, cost check should fire.
      const spawnFn = async () => ({
        agent: "mock",
        agentSource: "test",
        task: "test",
        exitCode: 0,
        messages: [],
        stderr: "",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 3.00, contextTokens: 0, turns: 1 },
        output: "done",
      } as SingleResult);

      const result = await executeWorkflow({
        name: "expensive",
        tasks: [
          { id: "t1", prompt: "Big task 1", files: ["src/a.ts"], dependsOn: [] },
          { id: "t2", prompt: "Big task 2", files: ["src/b.ts"], dependsOn: ["t1"] },
          { id: "t3", prompt: "Big task 3", files: ["src/c.ts"], dependsOn: ["t2"] },
        ],
        options: { maxCost: 5, reserveFiles: false, autoApproveGates: true, maxParallel: 1 },
        runtime: { cwd: tmp },
        spawnFn,
      });

      // After wave 0 (t1), cost=3. After wave 1 (t2), cost=6 > 5, so wave 2 (t3) should stop.
      expect(result.status).toBe("cost_exceeded");
      expect(result.tasks.filter((t) => t.status === "complete").length < 3).toBe(true);
    } finally {
      rmTmpDir(tmp);
    }
  });

  it("aborts on signal", async () => {
    const tmp = mkTmpDir("exec-test-");
    try {
      const controller = new AbortController();
      // Abort after 150ms, halfway through wave 1 (which takes 200ms)
      setTimeout(() => controller.abort(), 150);

      const spawnFn = async (opts: any) => {
        if (opts.signal?.aborted) {
          return {
            agent: "mock", agentSource: "test", task: "test", exitCode: 1,
            messages: [], stderr: "Aborted",
            usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
            stopReason: "aborted", output: "",
          } as SingleResult;
        }
        await new Promise((r) => setTimeout(r, 200));
        return {
          agent: "mock", agentSource: "test", task: "test", exitCode: 0,
          messages: [], stderr: "",
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
          output: "done",
        } as SingleResult;
      };

      // Chained: each task depends on the previous
      // Wave 0: t0 (0-200ms)
      // Wave 1: t1 (200-400ms) → abort at 150ms fires during t0, but t0 already started
      // Actually abort at 150ms happens AFTER t0 was spawned. At 200ms t0 completes.
      // Then loop checks signal at start of wave 1 (200ms). But abort fired at 150ms.
      // So wave 1 should not start.
      const result = await executeWorkflow({
        name: "slow",
        tasks: [
          { id: "t0", prompt: "task 0", dependsOn: [] },
          { id: "t1", prompt: "task 1", dependsOn: ["t0"] },
          { id: "t2", prompt: "task 2", dependsOn: ["t1"] },
        ],
        options: { maxCost: 10, reserveFiles: false, maxParallel: 1 },
        runtime: { cwd: tmp },
        signal: controller.signal,
        spawnFn,
      });

      expect(result.status).toBe("aborted");
      expect(result.tasks.filter((t) => t.status === "complete").length < 3).toBe(true);
    } finally {
      rmTmpDir(tmp);
    }
  });
});

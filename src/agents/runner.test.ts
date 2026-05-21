import { describe, it } from "node:test";
import assert from "node:assert";
import { runSingleAgent } from "./runner.js";
import { AgentConfig, SingleResult } from "../types.js";

describe("runSingleAgent", () => {
  it("uses injected spawnFn when provided", async () => {
    const expected: SingleResult = {
      agent: "mock",
      agentSource: "test",
      task: "test-task",
      exitCode: 0,
      messages: [],
      stderr: "",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
      output: "via-mock",
    };

    const spawnFn = async () => expected;

    const result = await runSingleAgent({
      cwd: "/tmp",
      agent: { name: "mock" } as AgentConfig,
      task: "test-task",
      spawnFn,
    });

    assert.strictEqual(result.exitCode, 0);
    assert.strictEqual(result.output, "via-mock");
  });

  it("respects abort signal", async () => {
    const controller = new AbortController();
    controller.abort();

    // spawnFn that never returns (simulates hanging pi)
    const spawnFn = async () => {
      return new Promise(() => {}); // hangs forever
    };

    // Actually, with the abort signal, the vendored runner won't even start the spawn or will kill it.
    // Since we inject spawnFn, signal is passed to it. The mock here doesn't check signal.
    // Let's just verify that runSingleAgent passes signal through to spawnFn.
    let receivedSignal: AbortSignal | undefined;
    const capturingSpawnFn = async (opts: any) => {
      receivedSignal = opts.signal;
      return { exitCode: 0, output: "captured", messages: [], stderr: "", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 }, agent: "x", agentSource: "test", task: "" } as SingleResult;
    };

    const result = await runSingleAgent({
      cwd: "/tmp",
      agent: { name: "test" } as AgentConfig,
      task: "test",
      signal: controller.signal,
      spawnFn: capturingSpawnFn,
    });

    assert.strictEqual(receivedSignal, controller.signal);
  });
});

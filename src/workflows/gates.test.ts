import { describe, it } from "node:test";
import assert from "node:assert";
import { extractVerdict, challengeCycle } from "./gates.js";

describe("extractVerdict", () => {
  it("parses APPROVE from JSON", () => {
    const v = extractVerdict('{"verdict": "APPROVE"}');
    assert.strictEqual(v.verdict, "APPROVE");
  });

  it("parses NEEDS_CHANGES with feedback", () => {
    const v = extractVerdict(
      '{"verdict": "NEEDS_CHANGES", "feedback": "Missing bounds check"}'
    );
    assert.strictEqual(v.verdict, "NEEDS_CHANGES");
    assert.strictEqual(v.feedback, "Missing bounds check");
  });

  it("parses CHALLENGE with severity", () => {
    const v = extractVerdict(
      '{"verdict": "CHALLENGE", "message": "Why no tests?", "severity": "blocking"}'
    );
    assert.strictEqual(v.verdict, "CHALLENGE");
    assert.strictEqual(v.message, "Why no tests?");
    assert.strictEqual(v.severity, "blocking");
  });

  it("defaults to APPROVE on unparseable output", () => {
    const v = extractVerdict("just some random text");
    assert.strictEqual(v.verdict, "APPROVE");
  });

  it("heuristic: detects approve keyword", () => {
    const v = extractVerdict("Everything looks great. I approve this change.");
    assert.strictEqual(v.verdict, "APPROVE");
  });

  it("heuristic: detects needs changes keyword", () => {
    const v = extractVerdict("This needs changes before merging.");
    assert.strictEqual(v.verdict, "NEEDS_CHANGES");
  });
});

describe("challengeCycle", () => {
  it("resolves immediately on first APPROVE", async () => {
    let calls = 0;
    const result = await challengeCycle({
      task: { id: "t1", prompt: "test" },
      initialResult: {
        agent: "worker",
        agentSource: "test",
        task: "test",
        exitCode: 0,
        messages: [],
        stderr: "",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
      },
      challengeMessage: "fix it",
      team: { worker: { name: "worker" }, reviewer: { name: "reviewer" } },
      maxCycles: 2,
      workflowDir: "/tmp",
      runtime: { cwd: "/tmp" },
      spawnFn: async () => ({
        agent: "reviewer",
        agentSource: "test",
        task: "review",
        exitCode: 0,
        output: '{"verdict": "APPROVE"}',
        messages: [],
        stderr: "",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
      }),
    });

    assert.strictEqual(result.status, "resolved");
  });

  it("exhausts maxCycles and returns exceeded", async () => {
    let calls = 0;
    const result = await challengeCycle({
      task: { id: "t1", prompt: "test" },
      initialResult: {
        agent: "worker",
        agentSource: "test",
        task: "test",
        exitCode: 0,
        messages: [],
        stderr: "",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
      },
      challengeMessage: "round-1",
      team: { worker: { name: "worker" }, reviewer: { name: "reviewer" } },
      maxCycles: 2,
      workflowDir: "/tmp",
      runtime: { cwd: "/tmp" },
      spawnFn: async () => {
        calls++;
        return {
          agent: "reviewer",
          agentSource: "test",
          task: "review",
          exitCode: 0,
          output: `{"verdict": "CHALLENGE", "message": "round-${calls}"}`,
          messages: [],
          stderr: "",
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
        };
      },
    });

    assert.strictEqual(result.status, "max_cycles_exceeded");
    // Each challenge cycle calls spawnFn twice: once for worker, once for reviewer
    // With maxCycles=2, total calls = 2 cycles × 2 = 4
    assert.strictEqual(calls, 4);
  });

  it("aborts early on signal", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await challengeCycle({
      task: { id: "t1", prompt: "test" },
      initialResult: {
        agent: "worker",
        agentSource: "test",
        task: "test",
        exitCode: 0,
        messages: [],
        stderr: "",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
      },
      challengeMessage: "fix",
      team: {},
      maxCycles: 2,
      workflowDir: "/tmp",
      runtime: { cwd: "/tmp" },
      signal: controller.signal,
    });

    assert.strictEqual(result.status, "needs_changes");
  });
});

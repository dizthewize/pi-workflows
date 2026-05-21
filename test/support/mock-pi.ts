/**
 * Mock Pi subprocess for integration tests.
 */

import { SingleResult } from "../../src/types.js";

export interface MockResponse {
  output: string;
  exitCode?: number;
  usage?: {
    cost: number;
    turns: number;
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    contextTokens?: number;
  };
  filesModified?: string[];
  delay?: number;
}

export interface MockPiConfig {
  defaultResponse: MockResponse;
  behaviors?: Record<string, MockResponse>;
  delay?: number;
}

export interface SpawnOptions {
  cwd: string;
  agent: Record<string, unknown>;
  task: string;
  signal?: AbortSignal;
  [key: string]: unknown;
}

export interface MockSpawnCall {
  args: SpawnOptions;
  startTime: number;
}

export function createMockPi(config: MockPiConfig) {
  const spawns: MockSpawnCall[] = [];
  let defaultResponse = config.defaultResponse;

  function extractTaskFromArgs(args: SpawnOptions): string {
    // task is the last element in args after "Task: "
    const taskArg = args.task;
    if (typeof taskArg === "string") return taskArg;
    return "";
  }

  function buildJSONLLines(response: MockResponse): string[] {
    const usage: Record<string, number> = {
      input: response.usage?.input ?? 0,
      output: response.usage?.output ?? 0,
      cacheRead: response.usage?.cacheRead ?? 0,
      cacheWrite: response.usage?.cacheWrite ?? 0,
      totalTokens: response.usage?.contextTokens ?? 0,
    };
    const costObj: Record<string, number> = { total: response.usage?.cost ?? 0 };

    return [
      JSON.stringify({ type: "agent_start", task: response.output }),
      JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: response.output }], stopReason: "end_turn", usage, cost: costObj } }),
      JSON.stringify({ type: "agent_end", exitCode: response.exitCode ?? 0 }),
    ];
  }

  async function spawn(args: SpawnOptions): Promise<SingleResult> {
    const call: MockSpawnCall = { args, startTime: Date.now() };
    spawns.push(call);

    const behaviorKey = extractTaskFromArgs(args);
    const behavior = config.behaviors?.[behaviorKey] ?? defaultResponse;
    const delay = behavior.delay ?? config.delay ?? 0;

    if (delay > 0) {
      await new Promise((r) => setTimeout(r, delay));
    }

    // Check signal
    if (args.signal?.aborted) {
      return {
        agent: args.agent?.name as string ?? "mock",
        agentSource: "test",
        task: behaviorKey,
        exitCode: 1,
        messages: [],
        stderr: "Aborted",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
        stopReason: "aborted",
      };
    }

    return {
      agent: args.agent?.name as string ?? "mock",
      agentSource: "test",
      task: behaviorKey,
      exitCode: behavior.exitCode ?? 0,
      messages: [],
      stderr: "",
      usage: {
        input: behavior.usage?.input ?? 0,
        output: behavior.usage?.output ?? 0,
        cacheRead: behavior.usage?.cacheRead ?? 0,
        cacheWrite: behavior.usage?.cacheWrite ?? 0,
        cost: behavior.usage?.cost ?? 0,
        contextTokens: behavior.usage?.contextTokens ?? 0,
        turns: behavior.usage?.turns ?? 1,
      },
      output: behavior.output,
    };
  }

  return {
    spawn,
    getSpawns: () => spawns,
    setDefaultResponse: (r: MockResponse) => { defaultResponse = r; },
    getDefaultResponse: () => defaultResponse,
    cleanup: () => {},
  };
}

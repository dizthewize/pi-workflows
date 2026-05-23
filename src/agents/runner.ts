import { spawn, execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { AgentConfig, SingleResult, OnUpdateCallback, OutputLimits } from "../types.js";

/**
 * Read environment variables from the user's login shell.
 * Pi may have been started before env vars were set; this ensures
 * subprocesses get the same environment as a fresh terminal.
 */
function getShellEnv(): Record<string, string> {
  try {
    const shell = process.env.SHELL || "/bin/sh";
    const output = execSync(`${shell} -lc 'env'`, { encoding: "utf-8", timeout: 5000 });
    const env: Record<string, string> = {};
    for (const line of output.split("\n")) {
      const idx = line.indexOf("=");
      if (idx > 0) {
        env[line.slice(0, idx)] = line.slice(idx + 1);
      }
    }
    return env;
  } catch {
    return {};
  }
}

/** API key env vars that should be forwarded to subprocesses. */
const API_KEY_VARS = [
  "OPENCODE_API_KEY",
  "OLLAMA_API_KEY",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_OAUTH_TOKEN",
  "OPENAI_API_KEY",
  "DEEPSEEK_API_KEY",
  "GEMINI_API_KEY",
  "GROQ_API_KEY",
  "MISTRAL_API_KEY",
  "MOONSHOT_API_KEY",
  "FIREWORKS_API_KEY",
  "TOGETHER_API_KEY",
  "XAI_API_KEY",
  "AZURE_OPENAI_API_KEY",
  "HF_TOKEN",
  "CLOUDFLARE_API_KEY",
];

function buildSubprocessEnv(): NodeJS.ProcessEnv {
  const shellEnv = getShellEnv();
  const merged: NodeJS.ProcessEnv = { ...process.env };
  for (const key of API_KEY_VARS) {
    const shellVal = shellEnv[key];
    if (shellVal && shellVal.trim()) {
      merged[key] = shellVal;
    }
  }
  return merged;
}

export type SpawnFunction = (
  options: SpawnOptions
) => Promise<SingleResult>;

export interface SpawnOptions {
  cwd: string;
  agent: AgentConfig;
  task: string;
  signal?: AbortSignal;
  onUpdate?: OnUpdateCallback;
  useSubprocess?: boolean; // force subprocess mode
  extensions?: string[];
  attachments?: string[];
  outputLimits?: OutputLimits;
  artifactsDir?: string;
  artifactLabel?: string;
  customTools?: unknown[]; // for SDK mode
}

export interface RunSingleAgentOptions {
  cwd: string;
  agent: AgentConfig;
  task: string;
  signal?: AbortSignal;
  onUpdate?: OnUpdateCallback;
  outputLimits?: OutputLimits;
  artifactsDir?: string;
  artifactLabel?: string;
  extensions?: string[];
  attachments?: string[];
  spawnFn?: SpawnFunction;
}

export async function runSingleAgent(
  options: RunSingleAgentOptions
): Promise<SingleResult> {
  const {
    cwd,
    agent,
    task,
    signal,
    onUpdate,
    outputLimits,
    artifactsDir,
    artifactLabel,
    extensions,
    attachments,
    spawnFn,
  } = options;

  // If a custom spawnFn is injected (e.g., from mock or pi-subagents), use it
  if (spawnFn) {
    return spawnFn({
      cwd,
      agent,
      task,
      signal,
      onUpdate,
      outputLimits,
      artifactsDir,
      artifactLabel,
      extensions,
      attachments,
    });
  }

  return vendoredRunSingleAgent({
    cwd,
    agent,
    task,
    signal,
    onUpdate,
    outputLimits,
    artifactsDir,
    artifactLabel,
    extensions,
    attachments,
  });
}

const UPDATE_THROTTLE_MS = 250;
const MAX_RECENT_TOOLS = 5;

async function vendoredRunSingleAgent(
  options: SpawnOptions
): Promise<SingleResult> {
  const {
    cwd,
    agent,
    task,
    signal,
    onUpdate,
    artifactsDir,
    artifactLabel,
    extensions,
    attachments,
  } = options;

  const args: string[] = ["--mode", "json", "-p", "--no-session"];
  if (agent.model) args.push("--model", agent.model);

  if (agent.tools && agent.tools.length > 0) {
    args.push("--tools", agent.tools.join(","));
  }

  if (extensions) {
    for (const ext of extensions) {
      args.push("--extension", ext);
    }
  }

  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "pi-subagent-")
  );
  const tmpPromptPath = path.join(
    tmpDir,
    `prompt-${agent.name.replace(/[^\w.-]+/g, "_")}.md`
  );

  const systemPrompt = (agent.systemPrompt ?? "").trim();
  if (systemPrompt) {
    fs.writeFileSync(tmpPromptPath, systemPrompt, { encoding: "utf-8", mode: 0o600 });
    const promptFlag =
      agent.systemPromptMode === "override"
        ? "--system-prompt"
        : "--append-system-prompt";
    args.push(promptFlag, tmpPromptPath);
  }

  if (attachments) {
    for (const att of attachments) {
      args.push(`@${att}`);
    }
  }

  args.push(`Task: ${task}`);

  const startTime = Date.now();
  const runId = randomUUID();
  const artifactPath = path.join(
    artifactsDir ?? tmpDir,
    artifactLabel ?? agent.name,
    runId
  );
  fs.mkdirSync(artifactPath, { recursive: true });

  const currentResult: SingleResult = {
    agent: agent.name,
    agentSource: agent.source ?? "user",
    task,
    exitCode: 0,
    messages: [],
    stderr: "",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
      contextTokens: 0,
      turns: 0,
    },
    model: agent.model ?? undefined,
    artifactPaths: {
      inputPath: path.join(artifactPath, "input.md"),
      outputPath: path.join(artifactPath, "output.md"),
      metadataPath: path.join(artifactPath, "metadata.json"),
      jsonlPath: path.join(artifactPath, "transcript.jsonl"),
    },
    toolCount: 0,
    recentTools: [],
  };

  let lastUpdateMs = 0;
  const emitUpdate = (force = false) => {
    if (!onUpdate) return;
    const now = Date.now();
    if (!force && now - lastUpdateMs < UPDATE_THROTTLE_MS) return;
    lastUpdateMs = now;
    currentResult.durationMs = now - startTime;
    onUpdate({
      content: [{ type: "text", text: currentResult.output ?? "(running...)" }],
      details: { mode: "single", agentScope: "user", projectAgentsDir: null, results: [currentResult] },
    });
  };

  return new Promise((resolve) => {
    let wasAborted = false;
    let rawOutput = "";
    let buffer = "";

    const proc = spawn("pi", args, {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: buildSubprocessEnv(),
    });

    const jsonlFile = path.join(artifactPath, "transcript.jsonl");
    const jsonlStream = fs.createWriteStream(jsonlFile, { flags: "a" });

    const processLine = (line: string) => {
      if (!line.trim()) return;
      try {
        jsonlStream.write(line + "\n");
      } catch {}

      let event: unknown;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }

      const evt = event as Record<string, unknown>;

      if (evt.type === "tool_execution_start" && typeof evt.toolName === "string") {
        currentResult.toolCount = (currentResult.toolCount ?? 0) + 1;
        currentResult.currentTool = evt.toolName as string;
        emitUpdate();
      }

      if (evt.type === "tool_execution_end" && typeof evt.toolName === "string") {
        if (currentResult.currentTool) {
          currentResult.recentTools ??= [];
          currentResult.recentTools.unshift({
            tool: currentResult.currentTool,
            args: currentResult.currentToolArgs ?? "",
            endMs: Date.now(),
          });
          if (currentResult.recentTools.length > MAX_RECENT_TOOLS) {
            currentResult.recentTools = currentResult.recentTools.slice(0, MAX_RECENT_TOOLS);
          }
        }
        currentResult.currentTool = undefined;
        currentResult.currentToolArgs = undefined;
        emitUpdate();
      }

      if (evt.type === "message_start" && evt.message) {
        const msg = evt.message as Record<string, unknown>;
        if (!currentResult.model && msg.model) currentResult.model = msg.model as string;
        emitUpdate();
      }

      if (evt.type === "message_update" && evt.message) {
        const msg = (evt.message as Record<string, unknown>);
        const content = (msg.content as Array<{ type: string; text?: string }>) ?? [];
        const lines = content
          .filter((b) => b.type === "text" && b.text)
          .flatMap((b) => (b.text as string).split("\n"))
          .filter((l) => l.trim());
        if (lines.length) {
          currentResult.output = lines.slice(-8).join("\n");
          emitUpdate();
        }
      }

      if (evt.type === "message_end" && evt.message) {
        const msg = (evt.message as Record<string, any>);
        currentResult.messages.push(msg as any);

        if (msg.role === "assistant") {
          currentResult.usage.turns++;
          const usage = msg.usage as Record<string, number> | undefined;
          if (usage) {
            currentResult.usage.input += usage.input ?? 0;
            currentResult.usage.output += usage.output ?? 0;
            currentResult.usage.cacheRead += usage.cacheRead ?? 0;
            currentResult.usage.cacheWrite += usage.cacheWrite ?? 0;
            currentResult.usage.cost += (usage.cost as any)?.total ?? 0;
            currentResult.usage.contextTokens = usage.totalTokens ?? 0;
          }
          if (!currentResult.model && msg.model) currentResult.model = msg.model as string;

          const msgContent = (msg.content as Array<{ type: string; text?: string }>) ?? [];
          for (const block of msgContent) {
            if (block.type === "text" && block.text) {
              rawOutput += block.text;
            }
          }
        }
        emitUpdate(true);
      }
    };

    proc.stdout.on("data", (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) processLine(line);
    });

    proc.stderr.on("data", (data: Buffer) => {
      currentResult.stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (buffer.trim()) processLine(buffer);
      jsonlStream.end();

      currentResult.exitCode = code ?? 0;
      if (wasAborted) currentResult.stopReason = "aborted";
      currentResult.durationMs = Date.now() - startTime;
      currentResult.output = rawOutput || currentResult.output || "";

      // Write output + metadata files
      try {
        fs.writeFileSync(
          path.join(artifactPath, "output.md"),
          currentResult.output,
          "utf-8"
        );
      } catch {}

      try {
        fs.writeFileSync(
          path.join(artifactPath, "metadata.json"),
          JSON.stringify(
            {
              runId,
              agent: agent.name,
              task,
              model: currentResult.model,
              exitCode: currentResult.exitCode,
              startedAt: startTime,
              completedAt: Date.now(),
              durationMs: currentResult.durationMs,
              usage: currentResult.usage,
              stopReason: currentResult.stopReason,
            },
            null,
            2
          ),
          "utf-8"
        );
      } catch {}

      // Cleanup temp prompt file
      if (systemPrompt) {
        try { fs.unlinkSync(tmpPromptPath); } catch {}
        try { fs.rmdirSync(tmpDir); } catch {}
      }

      resolve(currentResult);
    });

    proc.on("error", () => {
      jsonlStream.end();
      currentResult.exitCode = 1;
      resolve(currentResult);
    });

    if (signal) {
      const killProc = () => {
        wasAborted = true;
        proc.kill("SIGTERM");
        setTimeout(() => {
          if (!proc.killed) proc.kill("SIGKILL");
        }, 5000);
      };
      if (signal.aborted) killProc();
      else signal.addEventListener("abort", killProc, { once: true });
    }
  });
}

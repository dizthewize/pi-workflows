/**
 * Pi Workflows Extension
 *
 * Registers the execute_workflow tool and /workflows command.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { executeWorkflow } from "../workflows/executor.js";
import { renderWorkflowSummary } from "../utils.js";
import type { ExecuteWorkflowParams } from "../types.js";

const ROLES_FILE = path.join(os.homedir(), ".pi", "agent", "roles.json");

function loadRoles(): Record<string, unknown>[] {
  try {
    return JSON.parse(fs.readFileSync(ROLES_FILE, "utf-8")) as Record<string, unknown>[];
  } catch {
    return [];
  }
}

const TaskSchema = Type.Object({
  id: Type.String(),
  prompt: Type.String(),
  agent: Type.Optional(Type.String({ default: "worker" })),
  files: Type.Optional(Type.Array(Type.String(), { default: [] })),
  dependsOn: Type.Optional(Type.Array(Type.String(), { default: [] })),
  gate: Type.Optional(Type.Boolean({ description: "Override review gate (true to enforce, false to skip)" })),
  reviewAgent: Type.Optional(Type.String({ default: "reviewer" })),
  reviewPrompt: Type.Optional(Type.String()),
  maxChallengeCycles: Type.Optional(Type.Number({ default: 2 })),
  context: Type.Optional(Type.Any()),
});

const WorkflowOptionsSchema = Type.Object({
  maxParallel: Type.Optional(Type.Number({ default: 4 })),
  maxCost: Type.Optional(Type.Number({ default: 20 })),
  maxDurationMs: Type.Optional(Type.Number({ default: 1200000 })),
  reviewAfterEachWave: Type.Optional(Type.Boolean({ default: false })),
  autoApproveGates: Type.Optional(Type.Boolean({ default: false })),
  reserveFiles: Type.Optional(Type.Boolean({ default: true })),
  agentTeam: Type.Optional(Type.String()),
  saveLog: Type.Optional(Type.Boolean({ default: true })),
  failFast: Type.Optional(Type.Boolean({ default: false })),
});

const ExecuteWorkflowSchema = Type.Object({
  name: Type.String(),
  tasks: Type.Optional(Type.Array(TaskSchema)),
  plan: Type.Optional(Type.String({ description: "Path to TASK-XX markdown spec file (alternative to tasks[])" })),
  options: Type.Optional(WorkflowOptionsSchema),
});

type ExecuteWorkflowType = Static<typeof ExecuteWorkflowSchema>;

export default function piWorkflowsExtension(pi: ExtensionAPI) {
  // ── Bridge: respond to inter-extension requests via EventBus ──
  pi.events.on("workflows:plan:request", async (data) => {
    const { requestId, params, responseChannel } = data as any;
    try {
      let prd: string;
      try { prd = fs.readFileSync(params.input, "utf-8"); }
      catch (err) { throw new Error(`Failed to read PRD: ${err}`); }

      const roles = loadRoles();
      const plannerRole = roles.find((r) => r.id === "planner") as { systemPrompt?: string } | undefined;
      const systemPrompt = plannerRole?.systemPrompt ?? PLANNER_PROMPT;
      const userPrompt = `\n## PRD / Design Document\n\n${prd}\n\n## Instructions\n\nConvert the above PRD into a structured TASK-XX markdown spec.\nOutput ONLY the markdown spec. No extra commentary.\n`;

      const subagentFn =
        typeof (pi as any).subagent === "function"
          ? (pi as any).subagent
          : typeof (pi as any).api?.subagent === "function"
          ? (pi as any).api.subagent
          : null;

      let output: string;
      if (subagentFn) {
        try {
          const result = await subagentFn({ agent: "custom", config: { systemPrompt, systemPromptMode: "override" }, task: userPrompt, context: "fork", async: false });
          output = result?.output ?? String(result);
        } catch { output = "Planner execution failed."; }
      } else {
        output = `--- Planner Prompt (run manually) ---\n${systemPrompt}\n\n${userPrompt}\n--- End Planner Prompt ---`;
      }

      fs.mkdirSync(path.dirname(params.output), { recursive: true });
      fs.writeFileSync(params.output, output, "utf-8");
      pi.events.emit(responseChannel, { success: true, result: { outputPath: params.output, bytesWritten: output.length } });
    } catch (err) {
      pi.events.emit(responseChannel, { success: false, error: String(err) });
    }
  });

  pi.events.on("workflows:execute:request", async (data) => {
    const { requestId, params, responseChannel } = data as any;
    try {
      // Build role-based spawnFn if pi-agent-roles is available
      const toolNames = new Set(pi.getAllTools().map((t) => t.name));
      const hasRoles = toolNames.has("pi_roles");

      let spawnFn: any = undefined;
      if (hasRoles) {
        spawnFn = async (spawnOpts: any) => {
          const roleId = spawnOpts.agent?.name ?? "worker";
          return new Promise((resolve, reject) => {
            const rid = randomUUID();
            const unsub = pi.events.on(`roles:dispatch:response:${rid}`, (res: any) => {
              unsub();
              if (res.success) {
                resolve({ output: res.result?.output ?? "", exitCode: res.result?.exitCode ?? 0, durationMs: res.result?.durationMs ?? 0, usage: {} });
              } else {
                reject(new Error(res.error ?? "dispatch failed"));
              }
            });
            pi.events.emit("roles:dispatch:request", {
              requestId: rid,
              params: {
                roleId,
                task: spawnOpts.task,
                mode: "blocking",
                files: spawnOpts.files ?? [],
              },
              responseChannel: `roles:dispatch:response:${rid}`,
            });
            setTimeout(() => { unsub(); reject(new Error("Bridge spawn timeout")); }, 300_000);
          });
        };
      }

      const result = await executeWorkflow({
        name: params.name,
        tasks: params.tasks,
        plan: params.plan,
        options: params.options,
        runtime: { cwd: params.cwd ?? process.cwd() },
        spawnFn,
      });
      pi.events.emit(responseChannel, { success: true, result });
    } catch (err) {
      pi.events.emit(responseChannel, { success: false, error: String(err) });
    }
  });
  pi.registerTool({
    name: "execute_workflow",
    label: "Execute Workflow",
    description: `Run a dependency-aware multi-agent workflow. Define tasks with dependencies; the runtime topologically sorts them into parallel waves, reserves files, tracks cost, and enforces review gates on code-producing tasks.

Usage:
  execute_workflow({
    name: "auth-refactor",
    tasks: [
      { id: "types", prompt: "Create auth types", files: ["src/auth/types.ts"] },
      { id: "service", prompt: "Create auth service", files: ["src/auth/service.ts"], dependsOn: ["types"] },
      { id: "middleware", prompt: "Create middleware", files: ["src/middleware/auth.ts"], dependsOn: ["service"], gate: true }
    ],
    options: { maxParallel: 4, maxCost: 15 }
  })`,
    parameters: ExecuteWorkflowSchema,

    async execute(_toolCallId, rawParams, signal, onUpdate, ctx) {
      const params = rawParams as ExecuteWorkflowType;

      const result = await executeWorkflow({
        name: params.name,
        tasks: params.tasks,
        options: params.options,
        runtime: { cwd: ctx.cwd },
        onUpdate: (update) => {
          if (onUpdate) {
            onUpdate({
              content: update.content,
              details: update.details?.results.reduce(
                (acc, r) => {
                  acc[r.agent] = {
                    output: r.output,
                    exitCode: r.exitCode,
                    cost: r.usage?.cost,
                    durationMs: r.durationMs,
                  };
                  return acc;
                },
                {} as Record<string, unknown>
              ),
            });
          }
        },
        signal,
      });

      return {
        content: [{ type: "text", text: renderWorkflowSummary(result) }],
        details: result,
      };
    },

    renderCall(args, theme) {
      const taskCount = args.tasks?.length || 0;
      const depCount = (args.tasks ?? []).reduce(
        (sum, t) => sum + (t.dependsOn?.length ?? 0),
        0
      );
      const waveLabel = depCount > 0 ? `DAG (${depCount} deps)` : "parallel";
      return `${theme.fg("toolTitle", "execute_workflow")} ${theme.fg("accent", args.name)} ${theme.fg("muted", `${taskCount} tasks ${waveLabel}`)}`;
    },

    renderResult(result, _options, theme) {
      const outcome = result.isError
        ? theme.fg("error", "failed")
        : theme.fg("success", "done");
      return `${theme.fg("toolTitle", "execute_workflow")} ${outcome}`;
    },
  });

  // ── Plan Workflow ──
  const PlanWorkflowSchema = Type.Object({
    input: Type.String({ description: "Path to PRD / plan markdown file" }),
    output: Type.String({ description: "Path to write TASK-XX spec output" }),
    name: Type.Optional(Type.String({ description: "Workflow name (used for spec title)" })),
  });

  type PlanWorkflowType = Static<typeof PlanWorkflowSchema>;

  pi.registerTool({
    name: "plan_workflow",
    label: "Plan Workflow",
    description: `Convert a PRD or design document into a structured TASK-XX spec suitable for execute_workflow. Dispatches to the "planner" role if configured.

Usage:
  plan_workflow({ input: "./session-manager-plan.md", output: "./spec.md", name: "session-manager" })`,
    parameters: PlanWorkflowSchema,

    async execute(_toolCallId, rawParams, _signal, _onUpdate, _ctx) {
      const params = rawParams as PlanWorkflowType;

      // Read PRD
      let prd: string;
      try {
        prd = fs.readFileSync(params.input, "utf-8");
      } catch (err) {
        return {
          content: [{ type: "text", text: `Failed to read PRD: ${err}` }],
          isError: true,
        };
      }

      // Load planner role or use built-in prompt
      const roles = loadRoles();
      const plannerRole = roles.find((r) => r.id === "planner") as { systemPrompt?: string } | undefined;
      const systemPrompt = plannerRole?.systemPrompt ?? PLANNER_PROMPT;

      const userPrompt = `\n## PRD / Design Document\n\n${prd}\n\n## Instructions\n\nConvert the above PRD into a structured TASK-XX markdown spec.\nOutput ONLY the markdown spec. No extra commentary.\n`;

      // Execute via subagent if available, else return assembled prompt
      const subagentFn =
        typeof (pi as any).subagent === "function"
          ? (pi as any).subagent
          : typeof (pi as any).api?.subagent === "function"
          ? (pi as any).api.subagent
          : null;

      let output: string;
      if (subagentFn) {
        try {
          const result = await subagentFn({
            agent: "custom",
            config: { systemPrompt, systemPromptMode: "override" },
            task: userPrompt,
            context: "fork",
            async: false,
          });
          output = result?.output ?? String(result);
        } catch {
          output = "Planner execution failed. See manual prompt below.";
        }
      } else {
        output = `--- Planner Prompt (run manually) ---\n${systemPrompt}\n\n${userPrompt}\n--- End Planner Prompt ---`;
      }

      // Write output
      try {
        fs.mkdirSync(path.dirname(params.output), { recursive: true });
        fs.writeFileSync(params.output, output, "utf-8");
      } catch (err) {
        return {
          content: [{ type: "text", text: `Failed to write spec: ${err}` }],
          isError: true,
        };
      }

      return {
        content: [{ type: "text", text: `Spec written to ${params.output}\nPreview:\n${output.slice(0, 800)}${output.length > 800 ? "\n..." : ""}` }],
        details: { outputPath: params.output, bytesWritten: output.length },
      };
    },

    renderCall(args, theme) {
      return `${theme.fg("toolTitle", "plan_workflow")} ${theme.fg("accent", path.basename(args.input))} → ${theme.fg("muted", path.basename(args.output))}`;
    },

    renderResult(result, _opts, theme) {
      return result.isError
        ? `${theme.fg("toolTitle", "plan_workflow")} ${theme.fg("error", "failed")}`
        : `${theme.fg("toolTitle", "plan_workflow")} ${theme.fg("success", "ok")}`;
    },
  });

  pi.registerCommand("workflows", {
    description: "Open workflow dashboard: /workflows [status|pause|resume]",
    handler: async (args, ctx) => {
      // V1: just echo status. Full TUI dashboard is v1.1.
      const action = args[0] ?? "status";
      ctx.ui.notify(`Workflows: ${action} — full dashboard not yet implemented`, "info");
    },
  });
}

const PLANNER_PROMPT = \`You are a task planner for parallel agent execution. Convert a PRD into a structured TASK-XX markdown spec.

## Rules

1. **TASK-XX Format** — every task must have:
\`\`\`
## TASK-01: Brief title
Priority: P0|P1|P2|P3
Files: path/to/file.ts (create), path/to/other.ts (modify)
Depends on: none | TASK-01, TASK-02
Acceptance: What must be true for this task to be complete
\`\`\`

2. **Dependencies** — first task(s) MUST have \\"Depends on: none\\". No circular deps.

3. **File annotations** — append (create), (modify), or (delete) to each file path.

4. **Priority** — P0 = critical, P1 = needed, P2 = nice-to-have, P3 = cleanup.

5. **Task order** — types → backend → frontend → integration.

6. **Acceptance** — must be testable. Not \\"implement auth\\" but \\"POST /api/login returns 200 with JWT\\".

## Output

Return ONLY the markdown spec. No intro text, no markdown fences. Just raw TASK-XX starting with # Title.\`;

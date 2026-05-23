import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { randomUUID } from "node:crypto";
import { Task, WaveResult, WorkflowResult, WorkflowOptions, AgentTeam, SingleResult, TaskConfig, WorkflowStatus, ReviewGateResult, AgentRole, AgentConfig } from "../types.js";

const ROLE_STORE_PATH = path.join(os.homedir(), ".pi", "agent", "roles.json");
const MESH_DIR = path.join(os.homedir(), ".pi", "agent", "mesh");

function readRolesStore(): AgentRole[] {
  try {
    return JSON.parse(fsSync.readFileSync(ROLE_STORE_PATH, "utf-8")) as AgentRole[];
  } catch {
    return [];
  }
}

function resolveRoleConfig(roleId: string): AgentConfig | null {
  const roles = readRolesStore();
  const role = roles.find((r) => r.id === roleId);
  if (!role) return null;
  return {
    name: role.name,
    source: "pi-agent-roles",
    model: role.model === "default" ? null : (role.model ?? null),
    tools: role.tools ?? null,
    systemPrompt: role.systemPrompt,
    systemPromptMode: "override",
  };
}

/** Join mesh if workflow opts request it. Returns mesh agent id or null. */
function meshJoinIfRequested(
  opts: WorkflowOptions,
  name: string
): string | null {
  const meshPublish = opts.meshPublish;
  if (!meshPublish) return null;
  const agentName = opts.meshName ?? (typeof meshPublish === "string" ? meshPublish : name);
  const agentId = `${process.pid}-${randomUUID().slice(0, 8)}`;
  const registryDir = path.join(MESH_DIR, "registry");
  fsSync.mkdirSync(registryDir, { recursive: true });
  const entry = {
    id: agentId,
    name: agentName,
    model: "default",
    cwd: process.cwd(),
    sessionStartedAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    status: "working",
    reservedFiles: [],
    currentTaskId: undefined,
  };
  fsSync.writeFileSync(path.join(registryDir, `${agentId}.json`), JSON.stringify(entry, null, 2));
  return agentId;
}

function meshBroadcast(message: string): void {
  const inboxDir = path.join(MESH_DIR, "inbox");
  fsSync.mkdirSync(inboxDir, { recursive: true });
  const msg = {
    id: randomUUID(),
    from: "pi-workflows",
    fromName: "pi-workflows",
    to: "all",
    type: "broadcast",
    body: message,
    priority: "normal",
    timestamp: new Date().toISOString(),
    read: {},
  };
  fsSync.writeFileSync(
    path.join(inboxDir, `${Date.now()}-${msg.id}.json`),
    JSON.stringify(msg, null, 2)
  );
}

function meshLeave(agentId: string): void {
  const registryFile = path.join(MESH_DIR, "registry", `${agentId}.json`);
  try { fsSync.unlinkSync(registryFile); } catch { /* ignore */ }
}
import { parseDAG, validateDAG, topoSortWaves } from "./dag.js";
import { acquireWaveReservations, releaseReservations } from "./reservations.js";
import { CostTracker } from "./cost-tracker.js";
import { extractVerdict, challengeCycle } from "./gates.js";
import { runSingleAgent, SpawnFunction } from "../agents/runner.js";
import { resolveAgentConfig, loadAgentTeam } from "../agents/teams.js";
import { renderWorkflowSummary, generateLogMarkdown } from "../utils.js";
import { parseSpec, validateSpec, specToTasks } from "./spec-parser.js";
import { writeSnapshot, formatInlineBlock, formatCompactStatus, formatAgentLine, type WorkflowSnapshot, type AgentSnapshot, type WorkflowEvent } from "../registry.js";

export interface ExecutorOptions {
  name: string;
  tasks?: Task[];
  plan?: string;      // NEW — path to markdown plan file
  options?: WorkflowOptions;
  runtime: { cwd: string };
  onUpdate?: (update: { content: Array<{ type: string; text: string }>; details?: { mode: string; agentScope: string; projectAgentsDir: null; results: SingleResult[] } }) => void;
  signal?: AbortSignal;
  spawnFn?: SpawnFunction;
  defaultModel?: string;
}

export async function executeWorkflow(opts: ExecutorOptions): Promise<WorkflowResult> {
  const { name, tasks: rawTasks, plan, options = {}, runtime, onUpdate, signal, spawnFn, defaultModel } = opts;
  const startTime = Date.now();

  // Point A: resolve tasks from plan markdown if provided
  let tasks = rawTasks ?? [];
  if (plan) {
    try {
      const planContent = fsSync.readFileSync(plan, "utf-8");
      const spec = parseSpec(planContent);
      const validation = validateSpec(spec);
      if (!validation.valid) {
        return {
          status: "failed",
          workflow: { name, taskCount: 0, waveCount: 0 },
          waves: [],
          tasks: [],
          cost: { total: 0, byPhase: {} },
          durationMs: 0,
          filesModified: [],
          logPath: undefined,
        };
      }
      tasks = specToTasks(spec);
    } catch (err) {
      return {
        status: "failed",
        workflow: { name, taskCount: 0, waveCount: 0 },
        waves: [],
        tasks: [],
        cost: { total: 0, byPhase: {} },
        durationMs: 0,
        filesModified: [],
        logPath: undefined,
      };
    }
  }

  const workflowDir = path.join(runtime.cwd, ".pi", "workflows", name);
  fsSync.rmSync(workflowDir, { recursive: true, force: true });
  fsSync.mkdirSync(workflowDir, { recursive: true });

  // Resolve agent team
  const team = loadAgentTeam(options.agentTeam, runtime.cwd);

  // Validate and sort
  const dag = parseDAG(tasks);
  const validation = validateDAG(dag);
  if (!validation.valid) {
    return {
      status: "failed",
      workflow: { name, taskCount: tasks.length, waveCount: 0 },
      waves: [],
      tasks: [...dag.tasks.values()],
      cost: { total: 0, byPhase: {} },
      durationMs: 0,
      filesModified: [],
    };
  }

  const waves = topoSortWaves(tasks);

  // Persist initial state
  const initialStatePath = path.join(workflowDir, "config.json");
  fsSync.writeFileSync(
    initialStatePath,
    JSON.stringify({ name, tasks, options, waveCount: waves.length }, null, 2),
    "utf-8"
  );

  const costTracker = new CostTracker(workflowDir, options.maxCost ?? 20);
  const result: WorkflowResult = {
    status: "complete",
    workflow: { name, taskCount: tasks.length, waveCount: waves.length },
    waves: [],
    tasks: [],
    cost: costTracker.summary(),
    durationMs: 0,
    filesModified: [],
  };

  // Mesh join (Point D)
  const meshAgentId = meshJoinIfRequested(options, name);

  // Inline status snapshot
  const workflowId = `${name}-${Date.now()}`;
  let snapshot: WorkflowSnapshot = {
    id: workflowId,
    name,
    phase: "running",
    waveIndex: 0,
    waveCount: waves.length,
    agents: [],
    totalCost: 0,
    costLimit: options.maxCost,
    startedAt: startTime,
    updatedAt: startTime,
    events: [],
  };

  // Execute waves
  for (const wave of waves) {
    if (signal?.aborted) {
      result.status = "aborted";
      break;
    }

    if (costTracker.exceeded()) {
      result.status = "cost_exceeded";
      break;
    }

    const timeout = options.maxDurationMs;
    if (timeout && Date.now() - startTime >= timeout) {
      result.status = "timeout";
      break;
    }

    snapshot.waveIndex = wave.index;

    // File reservations
    if (options.reserveFiles !== false) {
      try {
        await acquireWaveReservations(wave, workflowDir);
      } catch (err) {
        if (options.failFast) {
          result.status = "failed";
          break;
        }
        // Mark tasks as failed and continue
        for (const t of wave.tasks) {
          t.status = "failed";
          t.errors = [String(err)];
        }
        continue;
      }
    }

    // Spawn agents in parallel
    const maxParallel = options.maxParallel ?? 4;
    const running: Map<number, Promise<SingleResult>> = new Map();
    const results: SingleResult[] = new Array(wave.tasks.length);
    const taskIds = wave.tasks.map((t) => t.id);

    // Build initial snapshot for this wave
    snapshot.agents = wave.tasks.map((t) => ({
      name: t.agent ?? "worker",
      status: "waiting",
      durationMs: 0,
      cost: 0,
      tokens: 0,
      turns: 0,
    }));
    snapshot.totalCost = costTracker.summary().total;
    snapshot.updatedAt = Date.now();
    writeSnapshot(snapshot);

    for (let i = 0; i < wave.tasks.length; i++) {
      if (running.size >= maxParallel) {
        // Wait for at least one to finish before spawning more
        const [idx, settled] = await Promise.race(
          [...running.entries()].map(
            ([k, p]) => p.then((r) => [k, r] as [number, SingleResult])
          )
        );
        running.delete(idx);
        results[idx] = settled;
        costTracker.add(settled.usage?.cost ?? 0, `task-${wave.tasks[idx].id}`);

        // Update snapshot with completed agent
        const completedAgent = snapshot.agents[idx];
        completedAgent.status = settled.exitCode === 0 ? "complete" : "failed";
        completedAgent.durationMs = settled.durationMs ?? 0;
        completedAgent.cost = settled.usage?.cost ?? 0;
        completedAgent.tokens = (settled.usage?.input ?? 0) + (settled.usage?.output ?? 0) + (settled.usage?.cacheRead ?? 0) + (settled.usage?.cacheWrite ?? 0);
        completedAgent.turns = settled.usage?.turns ?? 0;
        snapshot.totalCost = costTracker.summary().total;
        snapshot.updatedAt = Date.now();
        snapshot.events.push({
          ts: Date.now(),
          agent: completedAgent.name,
          type: completedAgent.status === "complete" ? "completed" : "failed",
          detail: wave.tasks[idx].id,
        });
        writeSnapshot(snapshot);

        // Send inline status update
        if (onUpdate) {
          const agentLine = formatAgentLine(completedAgent);
          const block = formatInlineBlock(snapshot);
          onUpdate({
            content: [{ type: "text" as const, text: `${agentLine}\n\n${block}` }],
            details: createWaveUpdate(wave, results),
          });
        }
      }

      const taskIdx = i;
      const task = wave.tasks[i];
      task.status = "running";

      let agentCfg: AgentConfig;
      if (task.roleId) {
        const roleCfg = resolveRoleConfig(task.roleId);
        agentCfg = roleCfg ?? resolveAgentConfig(task.agent ?? "worker", team);
      } else {
        agentCfg = resolveAgentConfig(task.agent ?? "worker", team);
      }
      if (defaultModel && !agentCfg.model) {
        agentCfg.model = defaultModel;
      }

      // Mark agent as running in snapshot
      snapshot.agents[taskIdx].status = "running";
      snapshot.updatedAt = Date.now();
      snapshot.events.push({
        ts: Date.now(),
        agent: snapshot.agents[taskIdx].name,
        type: "started",
        detail: task.id,
      });
      writeSnapshot(snapshot);

      const promise = runSingleAgent({
        cwd: runtime.cwd,
        agent: agentCfg,
        task: task.prompt,
        signal,
        onUpdate: (update) => {
          // Update snapshot with live agent progress
          const liveResult = update.details?.results?.[0];
          if (liveResult) {
            snapshot.agents[taskIdx].currentTool = liveResult.currentTool;
            snapshot.agents[taskIdx].toolArgs = liveResult.currentToolArgs;
            snapshot.agents[taskIdx].durationMs = liveResult.durationMs ?? 0;
            snapshot.agents[taskIdx].cost = liveResult.usage?.cost ?? 0;
            snapshot.agents[taskIdx].tokens = (liveResult.usage?.input ?? 0) + (liveResult.usage?.output ?? 0) + (liveResult.usage?.cacheRead ?? 0) + (liveResult.usage?.cacheWrite ?? 0);
            snapshot.agents[taskIdx].turns = liveResult.usage?.turns ?? 0;
            snapshot.updatedAt = Date.now();
            writeSnapshot(snapshot);
          }
          results[taskIdx] = liveResult ?? results[taskIdx];
        },
        artifactsDir: path.join(workflowDir, "results"),
        artifactLabel: task.id,
        spawnFn,
      }).then((res) => {
        results[taskIdx] = res;
        return res;
      });

      running.set(i, promise);
    }

    // Wait for remaining
    if (running.size > 0) {
      const settled = await Promise.all(
        [...running.entries()].map(([k, p]) => p.then((r) => [k, r] as [number, SingleResult]))
      );
      for (const [idx, res] of settled) {
        results[idx] = res;
        costTracker.add(res.usage?.cost ?? 0, `task-${wave.tasks[idx].id}`);

        // Update snapshot with completed agent
        const completedAgent = snapshot.agents[idx];
        completedAgent.status = res.exitCode === 0 ? "complete" : "failed";
        completedAgent.durationMs = res.durationMs ?? 0;
        completedAgent.cost = res.usage?.cost ?? 0;
        completedAgent.tokens = (res.usage?.input ?? 0) + (res.usage?.output ?? 0) + (res.usage?.cacheRead ?? 0) + (res.usage?.cacheWrite ?? 0);
        completedAgent.turns = res.usage?.turns ?? 0;
        snapshot.totalCost = costTracker.summary().total;
        snapshot.updatedAt = Date.now();
        snapshot.events.push({
          ts: Date.now(),
          agent: completedAgent.name,
          type: completedAgent.status === "complete" ? "completed" : "failed",
          detail: wave.tasks[idx].id,
        });
        writeSnapshot(snapshot);

        if (onUpdate) {
          const agentLine = formatAgentLine(completedAgent);
          const block = formatInlineBlock(snapshot);
          onUpdate({
            content: [{ type: "text" as const, text: `${agentLine}\n\n${block}` }],
            details: createWaveUpdate(wave, results),
          });
        }
      }
    }

    // Update task statuses
    let waveFailed = false;
    for (let i = 0; i < wave.tasks.length; i++) {
      const t = wave.tasks[i];
      const r = results[i];
      t.exitCode = r.exitCode;
      t.durationMs = r.durationMs;
      t.result = r.output?.slice(0, 4000); // keep result compact
      t.fullResultPath = path.join(workflowDir, "results", t.id, r.artifactPaths?.outputPath ?? "");
      t.cost = r.usage?.cost ?? 0;

      if (r.exitCode !== 0 || r.stopReason === "error" || r.stopReason === "aborted") {
        t.status = "failed";
        t.errors = [r.stderr?.slice(0, 500) || "Agent failed"];
        if (options.failFast) waveFailed = true;
      } else {
        t.status = "complete";
      }

      if (r.output) {
        try {
          fsSync.mkdirSync(path.join(workflowDir, "results", t.id), { recursive: true });
          fsSync.writeFileSync(
            path.join(workflowDir, "results", t.id, "output.md"),
            r.output,
            "utf-8"
          );
        } catch {}
      }
    }

    // Release reservations
    if (options.reserveFiles !== false) {
      await releaseReservations(workflowDir, wave.tasks.map((t) => t.id));
    }

    // Review gates (mandatory for code tasks unless gate: false)
    const gatedTasks: { task: TaskConfig; result: SingleResult }[] = [];
    for (let i = 0; i < wave.tasks.length; i++) {
      const t = wave.tasks[i];
      const r = results[i];
      const shouldGate = (t.gate ?? ((t.files?.length ?? 0) > 0)) && !options.autoApproveGates;
      if (shouldGate && t.status === "complete") {
        gatedTasks.push({ task: t, result: r });
      }
    }

    const gateResults: ReviewGateResult[] = [];
    if (gatedTasks.length > 0) {
      for (const { task, result: r } of gatedTasks) {
        if (signal?.aborted) break;

        task.status = "reviewing";
        const reviewerCfg = resolveAgentConfig(task.reviewAgent ?? "reviewer", team);

        const reviewPrompt = buildReviewerPrompt(task, r);
        const reviewRes = await runSingleAgent({
          cwd: runtime.cwd,
          agent: reviewerCfg,
          task: reviewPrompt,
          artifactsDir: path.join(workflowDir, "results"),
          artifactLabel: `${task.id}-review`,
          attachments: task.files,
          signal,
          spawnFn,
        });

        costTracker.add(reviewRes.usage?.cost ?? 0, `review-${task.id}`);
        const verdict = extractVerdict(reviewRes.output ?? "");
        gateResults.push(verdict);

        if (verdict.verdict === "APPROVE") {
          task.status = "complete";
        } else if (verdict.verdict === "NEEDS_CHANGES") {
          task.status = "needs_changes";
          if (options.failFast) {
            task.errors = [verdict.feedback ?? "Reviewer requested changes"];
            waveFailed = true;
          } else {
            // Re-run the task with feedback
            const retryResult = await retryWithFeedback(task, r, verdict.feedback ?? "", team, workflowDir, runtime, signal, spawnFn);
            results[wave.tasks.indexOf(task)] = retryResult;
            task.result = retryResult.output?.slice(0, 4000);
            task.cost = (task.cost ?? 0) + (retryResult.usage?.cost ?? 0);
            task.status = retryResult.exitCode === 0 ? "complete" : "failed";
          }
        } else if (verdict.verdict === "CHALLENGE") {
          const challengeResult = await challengeCycle({
            task,
            initialResult: r,
            challengeMessage: verdict.message ?? verdict.feedback ?? "Please fix.",
            team,
            maxCycles: task.maxChallengeCycles ?? 2,
            workflowDir,
            runtime,
            signal,
            spawnFn,
          });

          if (challengeResult.status === "resolved") {
            task.status = "complete";
            if (challengeResult.finalResult) {
              results[wave.tasks.indexOf(task)] = challengeResult.finalResult;
            }
          } else {
            task.status = "needs_changes";
            task.errors = [challengeResult.finalFeedback ?? "Challenge failed"];
            if (options.failFast) waveFailed = true;
          }
        }
      }
    }

    const waveResult: WaveResult = {
      wave,
      results,
      cost: results.reduce((s, r) => s + (r.usage?.cost ?? 0), 0),
      gateResult: gateResults.length > 0 ? gateResults[gateResults.length - 1] : undefined,
    };

    result.waves.push(waveResult);

    // Checkpoint
    const checkpointPath = path.join(workflowDir, "checkpoints", `wave-${wave.index}.json`);
    fsSync.mkdirSync(path.join(workflowDir, "checkpoints"), { recursive: true });
    fsSync.writeFileSync(checkpointPath, JSON.stringify({
      waveIndex: wave.index,
      tasks: wave.tasks.map((t) => ({ id: t.id, status: t.status })),
      cost: costTracker.summary(),
    }), "utf-8");

    if (onUpdate) {
      const summary = `Wave ${wave.index + 1} / ${waves.length} — ${wave.tasks.filter((t) => t.status === "complete").length}✓ ${wave.tasks.filter((t) => t.status === "failed").length}✗ — cost $${costTracker.summary().total.toFixed(2)}`;
      onUpdate({
        content: [{ type: "text", text: summary }],
        details: createWaveUpdate(wave, results),
      });
    }

    // Point D: broadcast wave completion
    if (meshAgentId) {
      meshBroadcast(`Wave ${wave.index + 1}/${waves.length} complete — ${wave.tasks.length} tasks — ${wave.tasks.filter(t => t.status === "complete").length} passed`);
      // Update lastSeenAt
      try {
        const regFile = path.join(MESH_DIR, "registry", `${meshAgentId}.json`);
        const reg = JSON.parse(fsSync.readFileSync(regFile, "utf-8"));
        reg.lastSeenAt = new Date().toISOString();
        fsSync.writeFileSync(regFile, JSON.stringify(reg, null, 2));
      } catch { /* ignore */ }
    }

    if (waveFailed && options.failFast) {
      result.status = "failed";
      break;
    }

    // Human wave gate
    if (options.reviewAfterEachWave) {
      // This is a sync pause — in a real impl, we'd use a future/promise that resolves on human input
      // For now, skip in automated mode; the TUI layer handles the pause
    }
  }

  // Final result assembly
  result.tasks = [...dag.tasks.values()];
  for (const w of result.waves) {
    for (let i = 0; i < w.wave.tasks.length; i++) {
      const t = result.tasks.find((x) => x.id === w.wave.tasks[i].id);
      if (t) {
        t.status = w.wave.tasks[i].status;
        t.cost = w.wave.tasks[i].cost;
        t.errors = w.wave.tasks[i].errors;
      }
    }
  }

  result.durationMs = Date.now() - startTime;
  result.cost = costTracker.summary();
  result.filesModified = [
    ...new Set(
      result.tasks
        .filter((t) => t.status === "complete")
        .flatMap((t) => t.files ?? [])
    ),
  ];

  if (result.status === "complete") {
    // Check if any task actually failed and we didn't break early
    const allComplete = result.tasks.every((t) => t.status === "complete" || t.status === "skipped");
    if (!allComplete) result.status = "failed";
  }

  if (options.saveLog !== false) {
    result.logPath = path.join(
      runtime.cwd,
      `workflow-log-${name}-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.md`
    );
    const logContent = generateLogMarkdown(workflowDir, result);
    fsSync.writeFileSync(result.logPath, logContent, "utf-8");
  }

  // Point D: broadcast workflow completion and leave mesh
  if (meshAgentId) {
    meshBroadcast(`Workflow "${name}" ${result.status} — ${result.workflow.waveCount} waves — cost $${result.cost.total.toFixed(2)}`);
    meshLeave(meshAgentId);
  }

  return result;
}

function createWaveUpdate(wave: any, results: SingleResult[]): { mode: string; agentScope: string; projectAgentsDir: null; results: SingleResult[] } {
  return {
    mode: "single",
    agentScope: "user",
    projectAgentsDir: null,
    results,
  };
}

function buildReviewerPrompt(task: TaskConfig, result: SingleResult): string {
  return `
Task ${task.id} has been completed by a worker.

Original prompt: "${task.prompt}"

Files modified: ${(task.files ?? []).join(", ") || "none"}

Please review the implementation for correctness, style, and adherence to requirements.

Return structured JSON in this exact format:
{
  "verdict": "APPROVE" | "NEEDS_CHANGES" | "CHALLENGE",
  "feedback": "detailed explanation",
  "message": "concise message",
  "severity": "blocking" | "non-blocking"
}

Only return the JSON. No extra text.
`;
}

async function retryWithFeedback(
  task: TaskConfig,
  previousResult: SingleResult,
  feedback: string,
  team: AgentTeam,
  workflowDir: string,
  runtime: { cwd: string },
  signal?: AbortSignal,
  spawnFn?: SpawnFunction
): Promise<SingleResult> {
  let agentCfg: AgentConfig;
  if (task.roleId) {
    const roleCfg = resolveRoleConfig(task.roleId);
    agentCfg = roleCfg ?? resolveAgentConfig(task.agent ?? "worker", team);
  } else {
    agentCfg = resolveAgentConfig(task.agent ?? "worker", team);
  }
  const prompt = `
${task.prompt}

The reviewer requested changes:
"${feedback}"

Please fix the issue and re-run any relevant tests.
`;

  return runSingleAgent({
    cwd: runtime.cwd,
    agent: agentCfg,
    task: prompt,
    artifactsDir: path.join(workflowDir, "results"),
    artifactLabel: `${task.id}-retry`,
    signal,
    spawnFn,
  });
}

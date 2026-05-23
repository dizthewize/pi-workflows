/**
 * WorkflowRegistry — file-backed state for live inline status.
 *
 * Writes compact JSON snapshots to:
 *   ~/.pi/workflows/registry/{workflow-id}.json
 *
 * Consumed by:
 *   - executor.ts onUpdate (renders inline markdown tables)
 *   - /workflows status command (reads latest state)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const REGISTRY_DIR = path.join(os.homedir(), ".pi", "workflows", "registry");

export interface AgentSnapshot {
  name: string;
  status: "running" | "complete" | "failed" | "waiting";
  currentFile?: string;
  currentTool?: string;
  toolArgs?: string;
  durationMs: number;
  cost: number;
  tokens: number;
  turns: number;
  progressPct?: number;
  startedAt?: number; // When this agent started running (for live timer)
}

export interface WorkflowSnapshot {
  id: string;
  name: string;
  phase: "running" | "complete" | "failed" | "aborted";
  waveIndex: number;
  waveCount: number;
  agents: AgentSnapshot[];
  totalCost: number;
  costLimit?: number;
  startedAt: number;
  updatedAt: number;
  events: WorkflowEvent[];
}

export interface WorkflowEvent {
  ts: number;
  agent: string;
  type: "tool_call" | "tool_result" | "started" | "completed" | "failed" | "waiting";
  detail: string;
}

function ensureDir(): void {
  try {
    fs.mkdirSync(REGISTRY_DIR, { recursive: true });
  } catch { /* ignore */ }
}

export function writeSnapshot(snap: WorkflowSnapshot): void {
  ensureDir();
  const file = path.join(REGISTRY_DIR, `${snap.id}.json`);
  try {
    fs.writeFileSync(file, JSON.stringify(snap, null, 2), { encoding: "utf-8" });
  } catch { /* ignore */ }
}

export function readSnapshot(id: string): WorkflowSnapshot | null {
  const file = path.join(REGISTRY_DIR, `${id}.json`);
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as WorkflowSnapshot;
  } catch {
    return null;
  }
}

export function listSnapshots(): WorkflowSnapshot[] {
  ensureDir();
  const out: WorkflowSnapshot[] = [];
  try {
    for (const f of fs.readdirSync(REGISTRY_DIR).filter((x) => x.endsWith(".json"))) {
      try {
        out.push(JSON.parse(fs.readFileSync(path.join(REGISTRY_DIR, f), "utf-8")) as WorkflowSnapshot);
      } catch { /* skip */ }
    }
  } catch { /* ignore */ }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function removeSnapshot(id: string): void {
  try { fs.unlinkSync(path.join(REGISTRY_DIR, `${id}.json`)); } catch { /* ignore */ }
}

/* ─── Formatting helpers ─── */

function fmtDur(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  if (m > 0) return `${m}m${String(s % 60).padStart(2, "0")}s`;
  return `${s}s`;
}

function fmtCost(n: number): string {
  return n < 0.01 && n > 0 ? "<0.01" : n.toFixed(2);
}

function fmtTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function pad(s: string, w: number): string {
  const vis = s.length; // ascii-only in our output
  return s + " ".repeat(Math.max(0, w - vis));
}

/** Compact inline status block (markdown code fence for alignment). */
export function formatInlineBlock(snap: WorkflowSnapshot): string {
  const elapsed = fmtDur(Date.now() - snap.startedAt);
  const running = snap.agents.filter((a) => a.status === "running").length;
  const done = snap.agents.filter((a) => a.status === "complete").length;
  const failed = snap.agents.filter((a) => a.status === "failed").length;
  const limit = snap.costLimit ? ` / $${snap.costLimit.toFixed(2)} limit` : "";

  const lines: string[] = [];
  lines.push(`Workflow: ${snap.name}  │  Wave ${snap.waveIndex + 1}/${snap.waveCount}  │  ${running}● ${done}✓ ${failed}✗`);
  lines.push(`Cost: $${fmtCost(snap.totalCost)}${limit}                    Elapsed: ${elapsed}`);
  lines.push("─".repeat(58));

  // Agents
  if (snap.agents.length > 0) {
    lines.push(pad("Agent", 14) + pad("File", 18) + pad("Status", 10) + pad("Dur", 8) + pad("Cost", 8));
    for (const a of snap.agents) {
      const icon = a.status === "complete" ? "✓" : a.status === "failed" ? "✗" : a.status === "running" ? "●" : "○";
      const name = (a.status === "running" ? "→ " : "  ") + a.name;
      const file = a.currentFile ? a.currentFile.replace(/^.*[/\\]/, "") : "----";
      const status = `${icon} ${a.status}`;
      const dur = a.durationMs > 0 ? fmtDur(a.durationMs) : "--";
      const cost = `$${fmtCost(a.cost)}`;
      lines.push(pad(name, 14) + pad(file, 18) + pad(status, 10) + pad(dur, 8) + pad(cost, 8));
    }
  }

  // Recent events
  const recent = snap.events.slice(-4);
  if (recent.length > 0) {
    lines.push("─".repeat(58));
    for (const ev of recent) {
      const rel = fmtDur(Date.now() - ev.ts);
      lines.push(`+${rel}  [${ev.agent}] ${ev.type}: ${ev.detail}`);
    }
  }

  // Cost breakdown by agent
  const byAgent = snap.agents
    .filter((a) => a.cost > 0)
    .map((a) => `${a.name} $${fmtCost(a.cost)}`)
    .join(" | ");
  if (byAgent) {
    lines.push("─".repeat(58));
    lines.push(`Cost: ${byAgent}`);
  }

  return lines.join("\n");
}

/** Single-line status for compact notifications. */
export function formatCompactStatus(snap: WorkflowSnapshot): string {
  const elapsed = fmtDur(Date.now() - snap.startedAt);
  const running = snap.agents.filter((a) => a.status === "running").length;
  const done = snap.agents.filter((a) => a.status === "complete").length;
  const failed = snap.agents.filter((a) => a.status === "failed").length;
  return `${snap.name} │ w${snap.waveIndex + 1}/${snap.waveCount} │ ${running}● ${done}✓ ${failed}✗ │ $${fmtCost(snap.totalCost)} │ ${elapsed}`;
}

/** Agent completion line. */
export function formatAgentLine(agent: AgentSnapshot): string {
  const icon = agent.status === "complete" ? "✅" : agent.status === "failed" ? "❌" : "⏳";
  const dur = fmtDur(agent.durationMs);
  const tok = fmtTok(agent.tokens);
  const file = agent.currentFile ? ` → ${agent.currentFile.replace(/^.*[/\\]/, "")}` : "";
  return `${icon} **${agent.name}** ${agent.status} (${dur}, $${fmtCost(agent.cost)}, ${tok} tokens)${file}`;
}

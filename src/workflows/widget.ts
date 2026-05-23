/**
 * WorkflowWidget — TUI overlay for live workflow progress.
 *
 * Inspired by pi-agent-teams dashboard: compact, info-dense,
 * named agents, task counts, token tracking.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { WorkflowSnapshot, AgentSnapshot } from "../registry.js";

const REGISTRY_DIR = path.join(os.homedir(), ".pi", "workflows", "registry");
const POLL_INTERVAL_MS = 1000;

interface Theme {
  fg(color: string, text: string): string;
}

interface TuiHandle {
  requestRender(): void;
}

export interface Component {
  render(width: number): string[];
  invalidate(): void;
}

export class WorkflowWidget implements Component {
  private snapshotId: string;
  private theme: Theme;
  private tui: TuiHandle;
  private pollInterval: NodeJS.Timeout | null = null;
  private disposed = false;
  private cachedLines: string[] = [];
  private cachedWidth = 0;
  private version = 0;
  private cachedVersion = -1;
  private lastError: string | null = null;

  constructor(
    snapshotId: string,
    tui: TuiHandle,
    theme: Theme,
  ) {
    this.snapshotId = snapshotId;
    this.tui = tui;
    this.theme = theme;
    this.startPolling();
  }

  dispose(): void {
    this.disposed = true;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  private startPolling(): void {
    this.pollInterval = setInterval(() => {
      if (this.disposed) return;
      this.version++;
      this.tui.requestRender();
    }, POLL_INTERVAL_MS);
  }

  invalidate(): void {
    this.version++;
  }

  render(width: number): string[] {
    if (width === this.cachedWidth && this.cachedVersion === this.version) {
      return this.cachedLines;
    }

    const th = this.theme;
    const lines: string[] = [];
    const innerWidth = Math.max(4, width - 4);

    const snap = this.readSnapshot();

    if (!snap) {
      lines.push(this.border("top", innerWidth, "Workflow"));
      const msg = this.lastError?.includes("ENOENT") ? "Starting..." : this.lastError ? `Error: ${this.lastError}` : "Starting...";
      lines.push(this.boxLine(th.fg("dim", msg), innerWidth));
      lines.push(this.border("bottom", innerWidth));
      this.cache(lines, width);
      return lines;
    }

    // ── Header ──
    const statusColor = snap.phase === "complete" ? "success" : snap.phase === "failed" ? "error" : "warning";
    const title = `${snap.name} | ${th.fg(statusColor, snap.phase.toUpperCase())}`;
    lines.push(this.border("top", innerWidth, title));

    // ── Summary bar ──
    const running = snap.agents.filter((a) => a.status === "running").length;
    const complete = snap.agents.filter((a) => a.status === "complete").length;
    const failed = snap.agents.filter((a) => a.status === "failed").length;
    const waiting = snap.agents.filter((a) => a.status === "waiting").length;

    const elapsed = this.formatElapsed(Date.now() - snap.startedAt);
    const cost = `$${snap.totalCost.toFixed(2)}`;
    const limit = snap.costLimit ? ` / $${snap.costLimit.toFixed(2)}` : "";

    // Always show all counts for consistent layout (like pi-agent-teams)
    const runningStr = running > 0 ? th.fg("warning", `●${running}`) : th.fg("dim", `●0`);
    const completeStr = complete > 0 ? th.fg("success", `✓${complete}`) : th.fg("dim", `✓0`);
    const failedStr = failed > 0 ? th.fg("error", `✗${failed}`) : th.fg("dim", `✗0`);
    const waitingStr = waiting > 0 ? th.fg("dim", `○${waiting}`) : th.fg("dim", `○0`);

    const left = `${runningStr}  ${completeStr}  ${failedStr}  ${waitingStr}`;
    const right = `${th.fg("dim", "⏱")} ${elapsed}  ${th.fg("dim", "$")}${cost}${limit}`;
    lines.push(this.boxLine(this.padBetween(left, right, innerWidth - 2), innerWidth));

    // ── Divider ──
    lines.push(this.boxLine(th.fg("borderMuted", "─".repeat(innerWidth - 2)), innerWidth));

    // ── Agent rows (pi-agent-teams style: name · status · task · time · cost) ──
    const sorted = [...snap.agents].sort((a, b) => {
      const order: Record<string, number> = { running: 0, waiting: 1, complete: 2, failed: 3 };
      return (order[a.status] ?? 9) - (order[b.status] ?? 9);
    });

    for (const agent of sorted) {
      const statusIcon = agent.status === "running" ? th.fg("warning", "●")
        : agent.status === "complete" ? th.fg("success", "✓")
        : agent.status === "failed" ? th.fg("error", "✗")
        : th.fg("dim", "○");

      // For running agents, compute live duration from startedAt
      const liveDur = agent.status === "running" && agent.startedAt
        ? Date.now() - agent.startedAt
        : agent.durationMs;
      const dur = this.formatElapsed(liveDur);
      const costStr = agent.cost > 0 ? `$${agent.cost.toFixed(2)}` : "";
      const tokensStr = agent.tokens > 0 ? `${this.formatTokens(agent.tokens)}` : "";
      const detail = agent.currentFile ? agent.currentFile.split("/").pop() ?? "" : "";
      const tool = agent.currentTool ? agent.currentTool.split("/").pop() ?? "" : "";
      const activity = detail || tool || (agent.status === "running" ? "working..." : "");

      // Compact row: icon name · status · time · cost/tokens
      const nameCol = `${statusIcon} ${th.fg("accent", agent.name)}`;
      const statusCol = th.fg("dim", agent.status);
      const timeCol = th.fg("dim", dur);
      const costCol = costStr ? th.fg("dim", costStr) : "";
      const tokCol = tokensStr ? th.fg("dim", tokensStr) : "";
      const activityCol = activity ? th.fg("dim", `→ ${activity}`) : "";

      // Build the row with smart spacing
      const parts = [nameCol, statusCol];
      if (activityCol) parts.push(activityCol);
      parts.push(timeCol);
      if (costCol) parts.push(costCol);
      if (tokCol) parts.push(tokCol);

      const row = parts.join("  ");
      lines.push(this.boxLine(row, innerWidth));
    }

    // ── Recent events (last 2) ──
    const recent = snap.events.slice(-2);
    if (recent.length > 0) {
      lines.push(this.boxLine(th.fg("borderMuted", "─".repeat(innerWidth - 2)), innerWidth));
      for (const ev of recent) {
        const ago = this.formatRelative(ev.ts);
        const icon = ev.type === "completed" ? "✓" : ev.type === "failed" ? "✗" : ev.type === "started" ? "▶" : "•";
        const evLine = `  ${th.fg("dim", ago)} ${icon} ${th.fg("accent", ev.agent)} ${ev.detail}`;
        lines.push(this.boxLine(evLine, innerWidth));
      }
    }

    lines.push(this.border("bottom", innerWidth));
    this.cache(lines, width);
    return lines;
  }

  private readSnapshot(): WorkflowSnapshot | null {
    const file = path.join(REGISTRY_DIR, `${this.snapshotId}.json`);
    try {
      const raw = fs.readFileSync(file, "utf-8");
      const parsed = JSON.parse(raw) as WorkflowSnapshot;
      this.lastError = null;
      return parsed;
    } catch (err) {
      this.lastError = String(err).slice(0, 40);
      return null;
    }
  }

  private border(type: "top" | "bottom", width: number, title?: string, titleColor = "accent"): string {
    const th = this.theme;
    const dim = (s: string) => th.fg("borderMuted", s);
    if (type === "top") {
      const titlePart = title ? ` ${th.fg(titleColor, title)} ` : "";
      const lineLen = width - 2;
      const pad = Math.max(0, lineLen - this.stripAnsi(titlePart).length);
      return dim(" ┌") + dim("─") + titlePart + dim("─".repeat(pad)) + dim("┐");
    }
    return dim(" └") + dim("─".repeat(width)) + dim("┘");
  }

  private boxLine(content: string, width: number): string {
    const th = this.theme;
    const visible = this.stripAnsi(content);
    const pad = Math.max(0, width - 2 - visible.length);
    return th.fg("borderMuted", " │") + content + " ".repeat(pad) + th.fg("borderMuted", "│");
  }

  private padBetween(left: string, right: string, width: number): string {
    const lv = this.stripAnsi(left);
    const rv = this.stripAnsi(right);
    const gap = Math.max(1, width - lv.length - rv.length);
    return left + " ".repeat(gap) + right;
  }

  private stripAnsi(str: string): string {
    // eslint-disable-next-line no-control-regex
    return str.replace(/\x1B\[[0-9;]*m/g, "");
  }

  private formatElapsed(ms: number): string {
    const s = Math.floor(Math.max(0, ms) / 1000);
    const m = Math.floor(s / 60);
    if (m > 9) return `${m}m`;
    if (m > 0) return `${m}:${String(s % 60).padStart(2, "0")}`;
    return `${s}s`;
  }

  private formatRelative(ts: number): string {
    const delta = Math.floor((Date.now() - ts) / 1000);
    if (delta < 60) return `+${delta}s`;
    return `+${Math.floor(delta / 60)}m`;
  }

  private formatTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
  }

  private cache(lines: string[], width: number): void {
    this.cachedLines = lines;
    this.cachedWidth = width;
    this.cachedVersion = this.version;
  }
}

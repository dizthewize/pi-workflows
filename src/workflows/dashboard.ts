/**
 * WorkflowDashboard — Full-screen TUI overlay for workflow status.
 *
 * Mirrors pi-coordination's CoordinationDashboard pattern.
 * Shown when user runs `/workflows dashboard` or via ctx.ui.custom().
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

interface Component {
  render(width: number): string[];
  invalidate(): void;
  handleInput?(data: string): void;
}

export class WorkflowDashboard implements Component {
  private snapshotId: string;
  private theme: Theme;
  private tui: TuiHandle;
  private done: () => void;
  private pollInterval: NodeJS.Timeout | null = null;
  private disposed = false;
  private cachedLines: string[] = [];
  private cachedWidth = 0;
  private version = 0;
  private cachedVersion = -1;
  private scrollOffset = 0;

  constructor(
    snapshotId: string,
    tui: TuiHandle,
    theme: Theme,
    _keybindings: unknown,
    done: () => void,
  ) {
    this.snapshotId = snapshotId;
    this.tui = tui;
    this.theme = theme;
    this.done = done;
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

      // Auto-dismiss when workflow completes
      const snap = this.readSnapshot();
      if (snap && (snap.phase === "complete" || snap.phase === "failed" || snap.phase === "aborted")) {
        setTimeout(() => {
          this.dispose();
          this.done();
        }, 5000);
      }
    }, POLL_INTERVAL_MS);
  }

  invalidate(): void {
    this.version++;
  }

  handleInput(data: string): void {
    if (data === "q" || data === "\u001b" || data === "\u0003") {
      this.dispose();
      this.done();
    } else if (data === "j" || data === "\u001b[B") {
      this.scrollOffset = Math.min(this.scrollOffset + 1, 50);
      this.invalidate();
      this.tui.requestRender();
    } else if (data === "k" || data === "\u001b[A") {
      this.scrollOffset = Math.max(this.scrollOffset - 1, 0);
      this.invalidate();
      this.tui.requestRender();
    }
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
      lines.push(this.border("top", innerWidth, "Workflow Dashboard"));
      lines.push(this.boxLine(th.fg("dim", "No active workflow snapshot."), innerWidth));
      lines.push(this.border("bottom", innerWidth));
      lines.push(this.boxLine(th.fg("dim", "q quit"), innerWidth));
      this.cache(lines, width);
      return lines;
    }

    // Header
    const statusColor = snap.phase === "complete" ? "success"
      : snap.phase === "failed" ? "error"
      : snap.phase === "aborted" ? "error"
      : "warning";
    const headerTitle = `${snap.name} | Wave ${snap.waveIndex + 1}/${snap.waveCount} | ${th.fg(statusColor, snap.phase.toUpperCase())}`;
    lines.push(this.border("top", innerWidth, headerTitle));

    // Stats row
    const running = snap.agents.filter((a: AgentSnapshot) => a.status === "running").length;
    const complete = snap.agents.filter((a: AgentSnapshot) => a.status === "complete").length;
    const failed = snap.agents.filter((a: AgentSnapshot) => a.status === "failed").length;
    const waiting = snap.agents.filter((a: AgentSnapshot) => a.status === "waiting").length;

    const elapsed = this.formatElapsed(Date.now() - snap.startedAt);
    const costStr = `$${snap.totalCost.toFixed(2)}`;
    const limitStr = snap.costLimit ? ` / $${snap.costLimit.toFixed(2)} limit` : "";

    const leftStats = [
      running > 0 ? th.fg("warning", `● running: ${running}`) : "",
      complete > 0 ? th.fg("success", `✓ complete: ${complete}`) : "",
      failed > 0 ? th.fg("error", `✗ failed: ${failed}`) : "",
      waiting > 0 ? th.fg("dim", `○ waiting: ${waiting}`) : "",
    ].filter(Boolean).join("  ");

    const rightStats = `${th.fg("dim", "⏱")} ${elapsed}  ${th.fg("dim", "Cost:")} ${costStr}${limitStr}`;
    lines.push(this.boxLine(this.padBetween(leftStats || th.fg("dim", "No agents"), rightStats, innerWidth - 2), innerWidth));
    lines.push(this.boxLine(th.fg("borderMuted", "─".repeat(innerWidth - 2)), innerWidth));

    // Agent table header
    const hdr = this.padCols(
      ["Agent", "File", "Status", "Dur", "Cost"],
      [0.22, 0.28, 0.18, 0.16, 0.16],
      innerWidth - 2,
    );
    lines.push(this.boxLine(th.fg("dim", hdr), innerWidth));
    lines.push(this.boxLine(th.fg("borderMuted", "─".repeat(innerWidth - 2)), innerWidth));

    // Agent rows
    const sortedAgents = [...snap.agents].sort((a, b) => {
      const order = { running: 0, waiting: 1, complete: 2, failed: 3 };
      return (order[a.status] ?? 9) - (order[b.status] ?? 9);
    });

    for (const agent of sortedAgents) {
      const statusIcon = agent.status === "running" ? th.fg("warning", "●")
        : agent.status === "complete" ? th.fg("success", "✓")
        : agent.status === "failed" ? th.fg("error", "✗")
        : th.fg("dim", "○");
      const file = agent.currentFile ? agent.currentFile.split("/").pop() ?? "" : "";
      // For running agents, compute live duration from startedAt
      const liveDur = agent.status === "running" && agent.startedAt
        ? Date.now() - agent.startedAt
        : agent.durationMs;
      const dur = this.formatElapsed(liveDur);
      const cost = `$${agent.cost.toFixed(2)}`;
      const row = this.padCols(
        [agent.name, file, `${statusIcon} ${agent.status}`, dur, cost],
        [0.22, 0.28, 0.18, 0.16, 0.16],
        innerWidth - 2,
      );
      lines.push(this.boxLine(row, innerWidth));
    }

    lines.push(this.boxLine(th.fg("borderMuted", "─".repeat(innerWidth - 2)), innerWidth));

    // Event log (scrollable)
    const events = snap.events.slice(-10 - this.scrollOffset, -this.scrollOffset || undefined).reverse();
    for (const ev of events) {
      const ago = this.formatRelative(ev.ts);
      const icon = ev.type === "completed" ? "✓"
        : ev.type === "failed" ? "✗"
        : ev.type === "started" ? "▶"
        : ev.type === "tool_call" ? "⚡"
        : ev.type === "tool_result" ? "↳"
        : "•";
      const evLine = `${th.fg("dim", ago)} ${icon} ${th.fg("accent", ev.agent)} ${ev.detail}`;
      lines.push(this.boxLine(evLine, innerWidth));
    }

    lines.push(this.border("bottom", innerWidth));
    lines.push(this.boxLine(th.fg("dim", "j/k scroll  |  q quit"), innerWidth));

    this.cache(lines, width);
    return lines;
  }

  private readSnapshot(): WorkflowSnapshot | null {
    const file = path.join(REGISTRY_DIR, `${this.snapshotId}.json`);
    try {
      const raw = fs.readFileSync(file, "utf-8");
      return JSON.parse(raw) as WorkflowSnapshot;
    } catch {
      return null;
    }
  }

  private border(type: "top" | "bottom", width: number, title?: string): string {
    const th = this.theme;
    const dim = (s: string) => th.fg("borderMuted", s);
    if (type === "top") {
      const titlePart = title ? ` ${title} ` : "";
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

  private padCols(cols: string[], widths: number[], totalWidth: number): string {
    let result = "";
    let used = 0;
    for (let i = 0; i < cols.length; i++) {
      const w = Math.floor(totalWidth * widths[i]);
      const text = cols[i];
      const vis = this.stripAnsi(text);
      const pad = Math.max(0, w - vis.length);
      result += text + " ".repeat(pad);
      used += w;
    }
    return result;
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

  private cache(lines: string[], width: number): void {
    this.cachedLines = lines;
    this.cachedWidth = width;
    this.cachedVersion = this.version;
  }
}

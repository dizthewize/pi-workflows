/**
 * WorkflowWidget — TUI overlay for live workflow progress.
 *
 * Mirrors pi-coordination's MiniDashboard pattern:
 *   - Implements Pi's Component interface
 *   - Polls snapshot JSON every 1s
 *   - Renders compact box widget via ctx.ui.setWidget()
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { WorkflowSnapshot, AgentSnapshot } from "../registry.js";

const REGISTRY_DIR = path.join(os.homedir(), ".pi", "workflows", "registry");
const POLL_INTERVAL_MS = 1000;

// Minimal theme shape we need (actual Pi theme has more)
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
      const msg = this.lastError ? `Error: ${this.lastError}` : "Loading...";
      lines.push(this.boxLine(th.fg("dim", msg), innerWidth));
      lines.push(this.border("bottom", innerWidth));
      this.cache(lines, width);
      return lines;
    }

    // Title bar
    const statusColor = snap.phase === "complete" ? "success"
      : snap.phase === "failed" ? "error"
      : "warning";
    const title = `${snap.name} | Wave ${snap.waveIndex + 1}/${snap.waveCount}`;
    lines.push(this.border("top", innerWidth, title, statusColor));

    // Agent summary row
    const running = snap.agents.filter((a: AgentSnapshot) => a.status === "running").length;
    const complete = snap.agents.filter((a: AgentSnapshot) => a.status === "complete").length;
    const failed = snap.agents.filter((a: AgentSnapshot) => a.status === "failed").length;
    const waiting = snap.agents.filter((a: AgentSnapshot) => a.status === "waiting").length;

    const summaryParts: string[] = [];
    if (running > 0) summaryParts.push(th.fg("warning", `●${running}`));
    if (complete > 0) summaryParts.push(th.fg("success", `✓${complete}`));
    if (failed > 0) summaryParts.push(th.fg("error", `✗${failed}`));
    if (waiting > 0) summaryParts.push(th.fg("dim", `○${waiting}`));

    const elapsed = this.formatElapsed(Date.now() - snap.startedAt);
    const cost = `$${snap.totalCost.toFixed(2)}`;
    const limit = snap.costLimit ? ` / $${snap.costLimit.toFixed(2)}` : "";

    const left = summaryParts.join("  ") || th.fg("dim", "Starting...");
    const right = `${th.fg("dim", "⏱")} ${elapsed}  ${th.fg("dim", "$")}${cost}${limit}`;
    const summaryLine = this.padBetween(left, right, innerWidth - 2);
    lines.push(this.boxLine(summaryLine, innerWidth));

    // Active agents (up to 3)
    const active = snap.agents.filter((a: AgentSnapshot) => a.status === "running").slice(0, 3);
    for (const agent of active) {
      const dur = this.formatElapsed(agent.durationMs);
      const file = agent.currentFile ? agent.currentFile.split("/").pop() ?? "" : "";
      const tool = agent.currentTool ? agent.currentTool.split("/").pop() ?? "" : "";
      const detail = [file, tool].filter(Boolean).join(" → ") || th.fg("dim", "working...");
      const agentLine = `  ${th.fg("accent", agent.name)} ${th.fg("dim", "→")} ${detail} ${th.fg("dim", dur)}`;
      lines.push(this.boxLine(agentLine, innerWidth));
    }

    // Recent events (last 2)
    const recent = snap.events.slice(-2);
    if (recent.length > 0) {
      lines.push(this.boxLine(th.fg("borderMuted", "─".repeat(innerWidth - 2)), innerWidth));
      for (const ev of recent) {
        const ago = this.formatRelative(ev.ts);
        const icon = ev.type === "completed" ? "✓"
          : ev.type === "failed" ? "✗"
          : ev.type === "started" ? "▶"
          : "•";
        const evLine = `  ${th.fg("dim", ago)} ${icon} ${th.fg("dim", ev.agent)} ${ev.detail}`;
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

  private border(
    type: "top" | "bottom",
    width: number,
    title?: string,
    titleColor = "accent",
  ): string {
    const th = this.theme;
    const dim = (s: string) => th.fg("borderMuted", s);

    if (type === "top") {
      const titlePart = title ? ` ${th.fg(titleColor, title)} ` : "";
      const lineLen = width - 2;
      const pad = Math.max(0, lineLen - titlePart.length);
      return dim(" ┌") + dim("─") + titlePart + dim("─".repeat(pad)) + dim("┐");
    }

    return dim(" └") + dim("─".repeat(width)) + dim("┘");
  }

  private boxLine(content: string, width: number): string {
    const th = this.theme;
    const visible = this.stripAnsi(content);
    const pad = Math.max(0, width - 2 - visible.length);
    const padded = content + " ".repeat(pad);
    return th.fg("borderMuted", " │") + padded + th.fg("borderMuted", "│");
  }

  private padBetween(left: string, right: string, width: number): string {
    const leftVis = this.stripAnsi(left);
    const rightVis = this.stripAnsi(right);
    const gap = Math.max(1, width - leftVis.length - rightVis.length);
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
    if (delta < 60) return `${delta}s`;
    return `${Math.floor(delta / 60)}m`;
  }

  private cache(lines: string[], width: number): void {
    this.cachedLines = lines;
    this.cachedWidth = width;
    this.cachedVersion = this.version;
  }
}

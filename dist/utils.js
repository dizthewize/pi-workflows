import { mkdirSync } from "node:fs";
export function truncateToWidth(str, width) {
    if (str.length <= width)
        return str;
    return str.slice(0, width);
}
export function formatCost(cost) {
    return "$" + cost.toFixed(2);
}
export function renderWorkflowSummary(result) {
    const { status, workflow, waves, cost, durationMs, filesModified } = result;
    const lines = [];
    const statusIcon = status === "complete" ? "✅" :
        status === "cost_exceeded" ? "💰" :
            status === "timeout" ? "⏱" :
                status === "aborted" ? "🛑" : "❌";
    lines.push(`${statusIcon} Workflow "${workflow.name}" — ${status}`);
    lines.push(`  Tasks: ${result.tasks.length} | Waves: ${waves.length} | Cost: ${formatCost(cost.total)} | Duration: ${formatDuration(durationMs)}`);
    const completed = result.tasks.filter((t) => t.status === "complete").length;
    const failed = result.tasks.filter((t) => t.status === "failed").length;
    lines.push(`  Complete: ${completed} | Failed: ${failed}`);
    if (filesModified.length > 0) {
        lines.push(`  Files modified: ${filesModified.join(", ")}`);
    }
    if (result.logPath) {
        lines.push(`  Log: ${result.logPath}`);
    }
    return lines.join("\n");
}
export function renderWaveSummary(wave) {
    const taskStatuses = wave.results.map((r) => {
        const icon = r.exitCode === 0 ? "✓" : "✗";
        return `${icon} ${r.agent}`;
    });
    return `Wave ${wave.wave.index}: ${taskStatuses.join(" ")} | ${formatCost(wave.cost)}`;
}
export function formatDuration(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}m ${seconds}s`;
}
export function generateLogMarkdown(workflowDir, result) {
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const lines = [];
    lines.push(`# Workflow Log: ${result.workflow.name}`);
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push("");
    lines.push(`Status: ${result.status}`);
    lines.push(`Duration: ${formatDuration(result.durationMs)}`);
    lines.push(`Total Cost: ${formatCost(result.cost.total)}`);
    lines.push(`Tasks: ${result.workflow.taskCount} | Waves: ${result.workflow.waveCount}`);
    lines.push("");
    lines.push("## Cost Breakdown");
    for (const [phase, cost] of Object.entries(result.cost.byPhase)) {
        lines.push(`- ${phase}: ${formatCost(cost)}`);
    }
    lines.push("");
    lines.push("## Task Results");
    for (const task of result.tasks) {
        const icon = task.status === "complete" ? "✅" :
            task.status === "failed" ? "❌" :
                task.status === "needs_changes" ? "🔄" : "⏳";
        lines.push(`${icon} **${task.id}** (${task.status})`);
        if (task.cost !== undefined)
            lines.push(`  Cost: ${formatCost(task.cost)}`);
        if (task.durationMs !== undefined)
            lines.push(`  Duration: ${formatDuration(task.durationMs)}`);
        if (task.files && task.files.length > 0)
            lines.push(`  Files: ${task.files.join(", ")}`);
        if (task.result)
            lines.push(`  Result: ${task.result}`);
        if (task.errors && task.errors.length > 0)
            lines.push(`  Errors: ${task.errors.join("; ")}`);
    }
    if (result.filesModified.length > 0) {
        lines.push("");
        lines.push("## Files Modified");
        result.filesModified.forEach((f) => lines.push(`- ${f}`));
    }
    return lines.join("\n");
}
export function mkdirpSync(dir) {
    mkdirSync(dir, { recursive: true });
}
//# sourceMappingURL=utils.js.map
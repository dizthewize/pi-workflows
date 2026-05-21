/**
 * Core type definitions for pi-workflows.
 */
export interface Task {
    id: string;
    prompt: string;
    agent?: string;
    roleId?: string;
    files?: string[];
    dependsOn?: string[];
    gate?: boolean;
    reviewAgent?: string;
    reviewPrompt?: string;
    maxChallengeCycles?: number;
    context?: Record<string, unknown>;
}
export type TaskStatus = "pending" | "claiming" | "running" | "awaiting_review" | "reviewing" | "needs_changes" | "complete" | "failed" | "skipped";
export interface TaskConfig extends Task {
    status: TaskStatus;
    exitCode?: number;
    result?: string;
    fullResultPath?: string;
    cost?: number;
    durationMs?: number;
    errors?: string[];
}
export interface Wave {
    index: number;
    tasks: TaskConfig[];
}
export interface SingleResult {
    agent: string;
    agentSource: string;
    task: string;
    exitCode: number;
    messages: unknown[];
    stderr: string;
    usage: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
        cost: number;
        contextTokens: number;
        turns: number;
    };
    model?: string;
    step?: number;
    output?: string;
    truncated?: boolean;
    outputMeta?: {
        byteCount: number;
        lineCount: number;
        charCount: number;
    };
    durationMs?: number;
    toolCount?: number;
    currentTool?: string;
    currentToolArgs?: string;
    recentTools?: Array<{
        tool: string;
        args: string;
        endMs: number;
    }>;
    artifactPaths?: {
        inputPath: string;
        outputPath: string;
        metadataPath: string;
        jsonlPath: string;
    };
}
export type WorkflowStatus = "complete" | "cost_exceeded" | "timeout" | "failed" | "aborted";
export interface CostSummary {
    total: number;
    byPhase: Record<string, number>;
}
export interface WorkflowResult {
    status: WorkflowStatus;
    workflow: {
        name: string;
        taskCount: number;
        waveCount: number;
    };
    waves: WaveResult[];
    tasks: TaskConfig[];
    cost: CostSummary;
    durationMs: number;
    filesModified: string[];
    logPath?: string;
}
export interface WaveResult {
    wave: Wave;
    results: SingleResult[];
    cost: number;
    gateResult?: ReviewGateResult;
}
export interface ReviewGateResult {
    verdict: "APPROVE" | "NEEDS_CHANGES" | "CHALLENGE";
    feedback?: string;
    message?: string;
    severity?: "blocking" | "non-blocking";
}
export interface AgentConfig {
    name: string;
    source?: string;
    model?: string | null;
    tools?: string[] | null;
    thinking?: string;
    systemPrompt?: string;
    systemPromptMode?: "append" | "override";
}
export interface AgentTeam {
    [role: string]: AgentConfig;
}
export interface AgentRole {
    id: string;
    name: string;
    systemPrompt: string;
    model?: string;
    skills?: string[];
    maxTokens?: number;
    tools?: string[];
    timeoutSeconds?: number;
    outputDir?: string;
    context?: "fresh" | "fork";
}
export interface WorkflowOptions {
    maxParallel?: number;
    maxCost?: number;
    maxDurationMs?: number;
    reviewAfterEachWave?: boolean;
    autoApproveGates?: boolean;
    reserveFiles?: boolean;
    agentTeam?: string;
    saveLog?: boolean;
    failFast?: boolean;
    meshPublish?: string | boolean;
    meshName?: string;
}
export interface OutputLimits {
    bytes?: number;
    lines?: number;
}
export interface OnUpdateCallback {
    (update: {
        content: Array<{
            type: string;
            text: string;
        }>;
        details?: {
            mode: string;
            agentScope: string;
            projectAgentsDir: null;
            results: SingleResult[];
        };
    }): void;
}
export interface ExecuteWorkflowParams {
    name: string;
    tasks?: Task[];
    plan?: string;
    options?: WorkflowOptions;
}
export interface ReservationEntry {
    taskId: string;
    files: string[];
    claimedAt: number;
    ttl: number;
    agent: string;
}
//# sourceMappingURL=types.d.ts.map
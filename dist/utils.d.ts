import { WorkflowResult, WaveResult } from "./types.js";
export declare function truncateToWidth(str: string, width: number): string;
export declare function formatCost(cost: number): string;
export declare function renderWorkflowSummary(result: WorkflowResult): string;
export declare function renderWaveSummary(wave: WaveResult): string;
export declare function formatDuration(ms: number): string;
export declare function generateLogMarkdown(workflowDir: string, result: WorkflowResult): string;
export declare function mkdirpSync(dir: string): void;
//# sourceMappingURL=utils.d.ts.map
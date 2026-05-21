import { CostSummary } from "../types.js";
export declare class CostTracker {
    private total;
    private byPhase;
    private logPath;
    readonly limit: number;
    constructor(workflowDir: string, limit: number);
    add(cost: number, phase: string): void;
    exceeded(): boolean;
    summary(): CostSummary;
    private save;
    private load;
}
//# sourceMappingURL=cost-tracker.d.ts.map
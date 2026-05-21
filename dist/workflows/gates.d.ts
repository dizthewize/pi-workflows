import { Task, SingleResult, AgentTeam, ReviewGateResult } from "../types.js";
export declare function extractVerdict(rawOutput: string): ReviewGateResult;
export interface ChallengeParams {
    task: Task;
    initialResult: SingleResult;
    challengeMessage: string;
    team: AgentTeam;
    maxCycles: number;
    workflowDir: string;
    runtime: {
        cwd: string;
    };
    signal?: AbortSignal;
    spawnFn?: SpawnFunction;
}
export interface ChallengeResult {
    status: "resolved" | "needs_changes" | "max_cycles_exceeded";
    finalResult?: SingleResult;
    finalFeedback?: string;
}
import { SpawnFunction } from "../agents/runner.js";
export declare function challengeCycle(params: ChallengeParams): Promise<ChallengeResult>;
//# sourceMappingURL=gates.d.ts.map